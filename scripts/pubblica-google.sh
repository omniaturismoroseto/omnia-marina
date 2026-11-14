#!/usr/bin/env bash
# Pubblica Omnia Marina su Google Cloud: database su Cloud SQL, app su Cloud Run.
#
# Si usa da Google Cloud Shell (https://shell.cloud.google.com), dalla cartella del progetto:
#
#   bash scripts/pubblica-google.sh                       pubblica, oppure aggiorna a una nuova versione
#   bash scripts/pubblica-google.sh stato                 mostra indirizzo e stato
#   bash scripts/pubblica-google.sh registro              ultime righe del registro dell'app (utile se qualcosa non va)
#   bash scripts/pubblica-google.sh chiudi-registrazione  nessuno può più registrare nuovi porti
#   bash scripts/pubblica-google.sh apri-registrazione    riapre la registrazione di nuovi porti
#   bash scripts/pubblica-google.sh elimina               cancella tutto (app, database e dati) e ferma i costi
#
# Lo script si può rilanciare quante volte si vuole: crea solo ciò che manca.
# Il progetto Google si sceglie a video oppure con PROGETTO=id-progetto davanti al comando;
# la regione con REGIONE=europe-west8 (predefinita: europe-west1, Belgio).

set -euo pipefail

REGION="${REGIONE:-europe-west1}"
SERVICE="omnia-marina"
SQL_INSTANCE="omnia-marina-db"
SQL_TIER="db-f1-micro"
DB_NAME="omnia_marina"
DB_USER="omnia_marina"
SECRET="omnia-marina-database-url"
RUN_ACCOUNT="omnia-marina-run"
APIS="run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com"

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die() {
  printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}

# Vero se la risorsa descritta dal comando esiste.
exists() { "$@" >/dev/null 2>&1; }

ask() {
  local answer
  read -r -p "$1 " answer || true
  printf '%s' "$answer"
}

# Vero se la risposta è un sì (si, sì, s, y, yes; maiuscole comprese).
confirmed() {
  case "$(ask "$1" | tr '[:upper:]' '[:lower:]')" in
    si | sì | s | y | yes) return 0 ;;
    *) return 1 ;;
  esac
}

# Ripete un comando fino a tre volte: alcune risorse appena create impiegano qualche secondo a comparire.
retry() {
  local attempt
  for attempt in 1 2 3; do
    "$@" && return 0
    [ "$attempt" -lt 3 ] && sleep 15
  done
  return 1
}

# Stampa "true" o "false" secondo l'impostazione attuale della registrazione di nuovi porti.
signup_setting() {
  gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format=json 2>/dev/null |
    python3 -c 'import json, sys
env = json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0].get("env", [])
print(next((e.get("value", "") for e in env if e.get("name") == "ALLOW_SIGNUP"), ""))' 2>/dev/null || true
}

choose_project() {
  PROJECT="${PROGETTO:-$(gcloud config get-value project 2>/dev/null || true)}"
  if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
    step "Su quale progetto Google vuoi pubblicare?"
    gcloud projects list --format="table(projectId,name)"
    PROJECT="$(ask "Scrivi l'ID del progetto (prima colonna):")"
  fi
  [ -n "$PROJECT" ] || die "Nessun progetto indicato."
  exists gcloud projects describe "$PROJECT" || die "Il progetto «$PROJECT» non esiste o non hai accesso."
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  CONNECTION_NAME="$PROJECT:$REGION:$SQL_INSTANCE"
  RUN_ACCOUNT_EMAIL="$RUN_ACCOUNT@$PROJECT.iam.gserviceaccount.com"
}

service_url() {
  gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)' 2>/dev/null || true
}

# ───────────────────────── Pubblicazione ─────────────────────────

publish() {
  [ -f Dockerfile ] && [ -f package.json ] || die "Lancia lo script dalla cartella del progetto: cd omnia-marina"
  choose_project

  local billing
  billing="$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || true)"
  if [ "$billing" = "False" ] || [ "$billing" = "false" ]; then
    die "Il progetto «$PROJECT» non ha la fatturazione attiva (piano Blaze). Attivala su https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT e rilancia lo script."
  fi

  local first_time=true
  exists gcloud sql instances describe "$SQL_INSTANCE" --project "$PROJECT" && first_time=false

  step "Riepilogo"
  info "Progetto:  $PROJECT"
  info "Regione:   $REGION"
  info "App:       Cloud Run, servizio «$SERVICE» (si paga a consumo, al massimo 2 istanze)"
  info "Database:  Cloud SQL PostgreSQL 16, istanza «$SQL_INSTANCE» ($SQL_TIER, 10 GB, backup giornalieri)"
  if $first_time; then
    info ""
    info "Il database è l'unica voce con un costo fisso: una decina di euro al mese finché esiste."
    info "Per fermare ogni costo: bash scripts/pubblica-google.sh elimina"
    confirmed "Procedo? (si/no)" || die "Annullato: non è stato creato nulla."
  else
    info "Il database esiste già: aggiorno solo l'app alla versione di questa cartella."
  fi

  step "Attivo i servizi Google necessari"
  # shellcheck disable=SC2086
  gcloud services enable $APIS --project "$PROJECT" --quiet
  ok "Servizi attivi"

  step "Database"
  if exists gcloud sql instances describe "$SQL_INSTANCE" --project "$PROJECT"; then
    ok "Istanza «$SQL_INSTANCE» già presente"
  else
    info "Creo l'istanza: servono dai 5 ai 10 minuti, non chiudere la finestra…"
    # --edition=enterprise: da PostgreSQL 16 l'edizione predefinita non prevede i tagli piccoli come db-f1-micro.
    gcloud sql instances create "$SQL_INSTANCE" --project "$PROJECT" \
      --database-version=POSTGRES_16 --edition=enterprise --tier="$SQL_TIER" --region="$REGION" \
      --storage-type=SSD --storage-size=10GB --storage-auto-increase \
      --backup-start-time=02:00 --deletion-protection --quiet
    ok "Istanza creata"
  fi
  if exists gcloud sql databases describe "$DB_NAME" --instance "$SQL_INSTANCE" --project "$PROJECT"; then
    ok "Database «$DB_NAME» già presente"
  else
    gcloud sql databases create "$DB_NAME" --instance "$SQL_INSTANCE" --project "$PROJECT" --quiet
    ok "Database «$DB_NAME» creato"
  fi

  step "Credenziali del database"
  if exists gcloud secrets describe "$SECRET" --project "$PROJECT"; then
    ok "Già presenti in Secret Manager (segreto «$SECRET»)"
  else
    # Password casuale, mai mostrata a video: resta solo in Secret Manager.
    local password
    password="$(openssl rand -hex 24)"
    if gcloud sql users list --instance "$SQL_INSTANCE" --project "$PROJECT" --format='value(name)' | grep -qx "$DB_USER"; then
      gcloud sql users set-password "$DB_USER" --instance "$SQL_INSTANCE" --project "$PROJECT" --password "$password" --quiet
    else
      gcloud sql users create "$DB_USER" --instance "$SQL_INSTANCE" --project "$PROJECT" --password "$password" --quiet
    fi
    # L'app raggiunge il database attraverso il collegamento privato che Cloud Run monta in /cloudsql.
    printf 'postgres://%s:%s@localhost/%s?host=/cloudsql/%s' "$DB_USER" "$password" "$DB_NAME" "$CONNECTION_NAME" |
      gcloud secrets create "$SECRET" --project "$PROJECT" --replication-policy=automatic --data-file=- --quiet
    ok "Utente «$DB_USER» creato, credenziali salvate in Secret Manager"
  fi

  step "Permessi"
  if ! exists gcloud iam service-accounts describe "$RUN_ACCOUNT_EMAIL" --project "$PROJECT"; then
    gcloud iam service-accounts create "$RUN_ACCOUNT" --project "$PROJECT" --display-name "Omnia Marina (app)" --quiet
    sleep 10 # il nuovo account impiega qualche secondo a essere visibile ovunque
  fi
  # L'app può solo collegarsi al database e leggere le proprie credenziali.
  retry gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$RUN_ACCOUNT_EMAIL" \
    --role roles/cloudsql.client --condition=None --quiet >/dev/null ||
    die "Non riesco ad assegnare i permessi all'app: serve il ruolo di Proprietario sul progetto."
  retry gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" --member "serviceAccount:$RUN_ACCOUNT_EMAIL" \
    --role roles/secretmanager.secretAccessor --quiet >/dev/null ||
    die "Non riesco a dare all'app l'accesso alle credenziali del database."
  # Cloud Build compila l'immagine con l'account predefinito del progetto, che deve poterlo fare.
  retry gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
    --role roles/run.builder --condition=None --quiet >/dev/null ||
    die "Non riesco ad assegnare i permessi di compilazione: aspetta un minuto e rilancia lo script."
  ok "Permessi impostati"

  step "Compilo e pubblico l'app (5-10 minuti)"
  local env_flags=()
  # Solo alla prima pubblicazione: registrazione aperta, per creare il porto. Agli aggiornamenti resta com'è.
  exists gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" || env_flags=(--set-env-vars "ALLOW_SIGNUP=true")
  if ! gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --source . \
    --allow-unauthenticated --service-account "$RUN_ACCOUNT_EMAIL" \
    --add-cloudsql-instances "$CONNECTION_NAME" --set-secrets "DATABASE_URL=$SECRET:latest" \
    --port 8080 --memory 512Mi --min-instances 0 --max-instances 2 --quiet ${env_flags[@]+"${env_flags[@]}"}; then
    die "Pubblicazione non riuscita. Se l'errore parla di permessi (PERMISSION_DENIED), aspetta due minuti e rilancia lo script: i permessi appena assegnati impiegano un po' ad attivarsi."
  fi

  local url code=000 attempt
  url="$(service_url)"
  step "Verifico che l'app risponda"
  for attempt in 1 2 3 4 5 6; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url/login" || true)"
    [ "$code" = "200" ] && break
    sleep 10
  done
  if [ "$code" != "200" ]; then
    info "L'app è stata pubblicata su $url ma la pagina di accesso risponde con il codice $code."
    [ "$code" != "403" ] || info "403 significa che il progetto non consente l'accesso pubblico al servizio (criterio dell'organizzazione)."
    die "Lancia «bash scripts/pubblica-google.sh registro» e invia il risultato a chi ti segue l'app."
  fi
  ok "La pagina di accesso risponde correttamente"

  step "Fatto"
  ok "Omnia Marina è in linea: $url"
  if [ ${#env_flags[@]} -gt 0 ]; then
    info ""
    info "Prossimi passi:"
    info "1. Apri $url/registrazione e crea il tuo porto e il tuo accesso."
    info "2. Subito dopo chiudi la registrazione, così nessun altro può creare porti:"
    info "     bash scripts/pubblica-google.sh chiudi-registrazione"
  fi
}

# ───────────────────────── Altri comandi ─────────────────────────

set_signup() {
  choose_project
  gcloud run services update "$SERVICE" --project "$PROJECT" --region "$REGION" --update-env-vars "ALLOW_SIGNUP=$1" --quiet
  if [ "$1" = "true" ]; then ok "Registrazione di nuovi porti aperta"; else ok "Registrazione di nuovi porti chiusa"; fi
}

status() {
  choose_project
  step "Stato"
  local url
  url="$(service_url)"
  if [ -n "$url" ]; then ok "App in linea: $url"; else info "App non pubblicata in $REGION"; fi
  if [ -n "$url" ]; then
    if [ "$(signup_setting)" = "true" ]; then
      info "Registrazione di nuovi porti: APERTA (chiudila con: bash scripts/pubblica-google.sh chiudi-registrazione)"
    else
      info "Registrazione di nuovi porti: chiusa"
    fi
  fi
  local state
  state="$(gcloud sql instances describe "$SQL_INSTANCE" --project "$PROJECT" --format='value(state)' 2>/dev/null || true)"
  if [ -n "$state" ]; then ok "Database «$SQL_INSTANCE»: $state"; else info "Database non presente"; fi
}

logs() {
  choose_project
  gcloud run services logs read "$SERVICE" --project "$PROJECT" --region "$REGION" --limit 80 ||
    gcloud beta run services logs read "$SERVICE" --project "$PROJECT" --region "$REGION" --limit 80
}

destroy() {
  choose_project
  step "Eliminazione di Omnia Marina dal progetto «$PROJECT»"
  info "Verranno cancellati l'app, il database con TUTTI I DATI e i suoi backup. Non si può annullare."
  [ "$(ask "Per confermare scrivi ELIMINA:")" = "ELIMINA" ] || die "Annullato: non è stato cancellato nulla."
  if exists gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION"; then
    gcloud run services delete "$SERVICE" --project "$PROJECT" --region "$REGION" --quiet
  fi
  if exists gcloud sql instances describe "$SQL_INSTANCE" --project "$PROJECT"; then
    gcloud sql instances patch "$SQL_INSTANCE" --project "$PROJECT" --no-deletion-protection --quiet
    gcloud sql instances delete "$SQL_INSTANCE" --project "$PROJECT" --quiet
  fi
  if exists gcloud secrets describe "$SECRET" --project "$PROJECT"; then
    gcloud secrets delete "$SECRET" --project "$PROJECT" --quiet
  fi
  if exists gcloud iam service-accounts describe "$RUN_ACCOUNT_EMAIL" --project "$PROJECT"; then
    gcloud iam service-accounts delete "$RUN_ACCOUNT_EMAIL" --project "$PROJECT" --quiet
  fi
  ok "Eliminato. Da questo momento Omnia Marina non genera più costi su questo progetto."
}

command -v gcloud >/dev/null 2>&1 || die "Comando gcloud non trovato: apri Google Cloud Shell su https://shell.cloud.google.com"

case "${1:-pubblica}" in
  pubblica) publish ;;
  stato) status ;;
  registro) logs ;;
  chiudi-registrazione) set_signup false ;;
  apri-registrazione) set_signup true ;;
  elimina) destroy ;;
  *) die "Comando sconosciuto «$1». Usa: pubblica, stato, registro, chiudi-registrazione, apri-registrazione, elimina" ;;
esac
