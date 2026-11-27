#!/usr/bin/env bash
# Pulizia dei dati di prova sul database di Google (Cloud SQL), da lanciare in Google Cloud Shell:
#   cd ~/omnia-marina && git pull origin main && bash scripts/pulisci-prove.sh
# oppure dal PC (PowerShell), che la lancia in Cloud Shell:
#   gcloud cloud-shell ssh --authorize-session --command "cd ~/omnia-marina && git pull origin main && bash scripts/pulisci-prove.sh"
# Senza parametri mostra che cosa cancella e chiede conferma; con «ELIMINA» dopo il nome mostra e cancella subito, poi fa un backup del database e pulisce.
# Via: contratti annullati e conclusi, scadenze e incassi di prova, prima nota (tranne gli incassi dei contratti attivi).
# Restano: bozze, contratti attivi con rate e incassi, clienti, barche, posti, listini e impostazioni.
# Le scritte a video sono senza accenti: arrivano leggibili anche nella finestra di PowerShell.

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${PROGETTO:-omnia-marina}"
REGION="${REGIONE:-europe-west1}"
SQL_INSTANCE="omnia-marina-db"
DB_NAME="omnia_marina"
DB_USER="omnia_marina"
SECRET="omnia-marina-database-url"
PORT=9471

step() { printf '\n== %s\n' "$*"; }
die() { printf 'ERRORE: %s\n' "$*" >&2; exit 1; }

command -v psql >/dev/null || die "Manca psql: lancia lo script da Google Cloud Shell."
command -v cloud-sql-proxy >/dev/null || die "Manca cloud-sql-proxy: lancia lo script da Google Cloud Shell."

# La password del database sta solo in Secret Manager (postgres://utente:password@...): non si mostra a video.
url="$(gcloud secrets versions access latest --secret "$SECRET" --project "$PROJECT")" || die "Non riesco a leggere le credenziali del database."
PGPASSWORD="$(printf '%s' "$url" | sed -E 's#^postgres(ql)?://[^:]+:([^@]+)@.*#\2#')"
[ -n "$PGPASSWORD" ] && [ "$PGPASSWORD" != "$url" ] || die "Credenziali del database in un formato inatteso."
export PGPASSWORD

# Collegamento al database attraverso il proxy di Cloud SQL (gia' installato in Cloud Shell), chiuso alla fine.
step "Collegamento al database (puo' servire qualche secondo)"
cloud-sql-proxy "$PROJECT:$REGION:$SQL_INSTANCE" --port "$PORT" >/tmp/pulisci-prove-proxy.log 2>&1 &
proxy=$!
trap 'kill "$proxy" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  pg_isready -h 127.0.0.1 -p "$PORT" -q && break
  sleep 1
done
pg_isready -h 127.0.0.1 -p "$PORT" -q || { cat /tmp/pulisci-prove-proxy.log; die "Il database non risponde."; }

run() { psql -h 127.0.0.1 -p "$PORT" -U "$DB_USER" -d "$DB_NAME" -X -v ON_ERROR_STOP=1 -f "$1"; }

step "Che cosa si cancella (per ora non cambia nulla)"
run scripts/sql/pulisci-prove-anteprima.sql

# Conferma: la parola ELIMINA dopo il nome dello script (dal PC la finestra non sempre lascia scrivere una risposta),
# altrimenti la si chiede.
echo
answer="${1:-}"
if [ -z "$answer" ]; then
  printf 'Per cancellare davvero scrivi ELIMINA e premi Invio (altro = annulla): '
  read -r answer || answer=""
fi
[ "$answer" = "ELIMINA" ] || { echo "Annullato: non ho cambiato nulla. Per cancellare rilancia con: bash scripts/pulisci-prove.sh ELIMINA"; exit 0; }
echo "Confermato: procedo."

step "Backup del database prima della pulizia"
gcloud sql backups create --instance "$SQL_INSTANCE" --project "$PROJECT" --description "Prima della pulizia dei dati di prova" --quiet
echo "Backup fatto: se serve si ripristina dalla console di Google Cloud (SQL, omnia-marina-db, Backup)."

step "Pulizia"
run scripts/sql/pulisci-prove.sql

step "Com'e' adesso"
run scripts/sql/pulisci-prove-anteprima.sql
