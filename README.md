# Omnia Marina

Gestionale per porti turistici e marine: posti barca, contratti di ormeggio, lavoro di banchina,
tariffe e contabilità interna. È una web app installabile (PWA) pensata per tre figure:

| Ruolo | Cosa fa |
|---|---|
| **Direzione** | Tutto, comprese impostazioni del porto, listini e utenti |
| **Ufficio** | Clienti, barche, contratti, addebiti e incassi, prima nota |
| **Operatore di banchina** | Mappa, arrivi e partenze, uscite in mare, segnalazioni. Nessun dato contabile |

Un'unica installazione serve **più porti**: ogni porto vede solo i propri dati e una persona può
lavorare per più porti con ruoli diversi.


## Moduli

- **Mappa dei posti barca** – pontili e posti in pianta, stato in tempo reale (libero, occupato, barca fuori,
  in arrivo, in partenza, oltre scadenza, non disponibile), situazione a una data qualsiasi.
- **Banchina** – pagina per telefono: arrivi attesi, partenze, barche fuori in mare, segnalazioni e movimenti del giorno.
- **Clienti e barche** – anagrafica completa di proprietario e unità, assicurazione con scadenze.
- **Privacy** – registro dei consensi con storico (chi, quando, quale versione dell'informativa), informativa
  stampabile, esportazione dei dati del cliente, cancellazione/anonimizzazione, registro delle operazioni.
- **Contratti** – annuali, stagionali, mensili e transiti; posti liberi e adatti alla barca proposti in automatico,
  importo calcolato dal listino, rate, stampa del contratto.
- **Tariffe** – listini per categoria e stagione (bassa, media, alta), simulatore.
- **Contabilità interna** – scadenziario, incassi anche parziali, prima nota di cassa e banca, riepilogo annuale,
  esportazione CSV per il commercialista. Non sostituisce la fatturazione elettronica.

## Avvio in locale

Servono Node.js 22, pnpm e PostgreSQL 16 (oppure Docker).

```bash
pnpm install
cp .env.example .env          # controlla DATABASE_URL
docker compose up -d          # avvia PostgreSQL (salta se ne hai già uno)
pnpm db:migrate               # crea le tabelle
pnpm db:seed                  # carica il porto dimostrativo
pnpm dev                      # http://localhost:3000
```

Accessi del porto demo (password `omnia-marina-demo` per tutti):

| Email | Ruolo |
|---|---|
| `direzione@omniamarina.example` | Direzione (ha due porti: mostra il cambio porto) |
| `ufficio@omniamarina.example` | Ufficio |
| `banchina@omniamarina.example` | Operatore di banchina |

Per partire da zero con un porto vero: apri `/registrazione`, crea il porto, poi configura pontili,
posti e tariffe. Con `ALLOW_SIGNUP=false` la registrazione di nuovi porti è disattivata.

## Comandi

| Comando | Cosa fa |
|---|---|
| `pnpm dev` | Avvia in sviluppo |
| `pnpm build` · `pnpm start` | Compila e avvia in produzione |
| `pnpm test` | Test automatici (tariffe, date e regole del porto su un database di prova) |
| `pnpm lint` · `pnpm typecheck` | Controlli statici |
| `pnpm db:generate` | Genera una migrazione dopo aver modificato `src/db/schema.ts` |
| `pnpm db:migrate` | Applica le migrazioni |
| `pnpm db:seed` | Ricrea il porto dimostrativo (gli altri porti non vengono toccati) |

I test sul database usano `omnia_marina_test` (variabile `TEST_DATABASE_URL`); se non è raggiungibile vengono saltati.

## Com'è fatto

- **Next.js 16** (App Router, Server Actions, Cache Components), **React 19**, **TypeScript**, **Tailwind CSS 4**.
- **PostgreSQL** con **Drizzle ORM**; migrazioni SQL in `drizzle/`.
- Autenticazione propria: password con scrypt, sessioni in database, cookie `httpOnly`.

```
src/
  app/(auth)/        accesso, registrazione, scelta del porto
  app/(app)/         le pagine dell'applicazione (una cartella per modulo)
  components/        componenti condivisi (moduli, tabelle, navigazione)
  db/schema.ts       tutte le tabelle
  lib/               funzioni pure: date, importi, tariffe, validazione
  server/            regole del porto (contratti, incassi) e azioni server
scripts/             migrazioni e dati dimostrativi
tests/               test automatici
```

### Regole che il codice garantisce

- **Separazione tra porti.** Ogni tabella ha `marina_id`; pagine e azioni lo ricavano dalla sessione
  (`requireMarina()`), mai dal browser.
- **Nessuna doppia assegnazione.** Due contratti attivi non possono occupare lo stesso posto nello stesso periodo:
  lo controlla l'applicazione e, in ultima istanza, un vincolo del database (`contracts_berth_no_overlap`).
- **Importi in centesimi**, misure in centimetri: niente arrotondamenti a sorpresa. Le rate sommano sempre al totale.
- **Ogni incasso** genera la riga di prima nota (cassa per i contanti, banca per il resto); stornandolo sparisce.
- **Dati personali**: l'operatore di banchina vede solo nome e telefono del proprietario; creazioni, modifiche,
  esportazioni e cancellazioni finiscono nel registro delle operazioni.

## Limiti attuali

- L'informativa privacy e le condizioni di contratto precompilate sono **modelli**: vanno fatti verificare da un consulente.
- Nessun invio di email o SMS (scadenze, solleciti) e nessun recupero password via email: la password la reimposta la direzione.
- Nessuna fatturazione elettronica né pagamenti online.
- Il diportista non ha ancora un proprio accesso (prenotazioni e area riservata sono un passo successivo).
- La mappa è schematica (pontile per pontile), non una planimetria in scala.
- L'app è installabile ma non funziona senza connessione.
- Il freno ai tentativi di accesso è in memoria: con più istanze del server va spostato su database o Redis.
