#!/usr/bin/env bash
# Pulizia dei dati di prova sul database di Google (Cloud SQL), da lanciare in Google Cloud Shell:
#   cd ~/omnia-marina && git pull origin main && bash scripts/pulisci-prove.sh
# Prima fa un backup del database, poi mostra che cosa cancella e chiede conferma.
# Via: contratti annullati e conclusi, scadenze e incassi di prova, prima nota (tranne gli incassi dei contratti attivi).
# Restano: bozze, contratti attivi con rate e incassi, clienti, barche, posti, listini e impostazioni.

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${PROGETTO:-omnia-marina}"
SQL_INSTANCE="omnia-marina-db"
DB_NAME="omnia_marina"
DB_USER="omnia_marina"
SECRET="omnia-marina-database-url"

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v psql >/dev/null || die "Manca psql: lancia lo script da Google Cloud Shell."

# La password del database sta solo in Secret Manager (postgres://utente:password@…): non si mostra a video.
url="$(gcloud secrets versions access latest --secret "$SECRET" --project "$PROJECT")" || die "Non riesco a leggere le credenziali del database."
PGPASSWORD="$(printf '%s' "$url" | sed -E 's#^postgres(ql)?://[^:]+:([^@]+)@.*#\2#')"
export PGPASSWORD

run() { gcloud sql connect "$SQL_INSTANCE" --project "$PROJECT" --user "$DB_USER" --database "$DB_NAME" --quiet < "$1"; }

step "Che cosa si cancella (per ora non cambia nulla)"
echo "  Collegamento al database: può servire un minuto…"
run scripts/sql/pulisci-prove-anteprima.sql

echo
read -r -p "Per cancellare davvero scrivi ELIMINA e premi Invio (altro = annulla): " answer
[ "$answer" = "ELIMINA" ] || { echo "Annullato: non ho cambiato nulla."; exit 0; }

step "Backup del database prima della pulizia"
gcloud sql backups create --instance "$SQL_INSTANCE" --project "$PROJECT" --description "Prima della pulizia dei dati di prova" --quiet
echo "  Backup fatto: se serve si ripristina dalla console di Google Cloud (SQL → omnia-marina-db → Backup)."

step "Pulizia"
run scripts/sql/pulisci-prove.sql

step "Com'è adesso"
run scripts/sql/pulisci-prove-anteprima.sql
