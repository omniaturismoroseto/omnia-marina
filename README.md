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

- **Mappa dei posti barca** – stato di ogni posto in tempo reale (libero, occupato, barca fuori, in arrivo,
  in partenza, oltre scadenza, non disponibile) e a una data qualsiasi. Due viste: lo **schema** pontile per
  pontile e la **pianta dal vero**, con i posti disegnati nelle misure reali sopra una foto aerea del porto.
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

### Pianta dal vero

Da **Impostazioni → Pianta dal vero** la direzione:

1. carica una foto del porto ripresa dall'alto e non inclinata (immagine salvata da Google Earth, ortofoto,
   drone o planimetria; JPEG o PNG, ridotta in automatico se molto grande);
2. imposta la scala cliccando i due estremi di una distanza nota (per esempio un pontile misurato con il righello
   di Google Earth) e scrivendone i metri;
3. traccia l'asse di ogni pontile con due clic, dalla radice alla testata: i suoi posti si dispongono da soli,
   perpendicolari al pontile e nelle dimensioni reali;
4. ritocca i singoli posti trascinandoli o ruotandoli, e salva.

Da quel momento la Mappa si apre sulla pianta; lo schema resta disponibile. Il porto dimostrativo usa una veduta
di fantasia (`scripts/demo/pianta-demo.jpg`).

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

## Pubblicazione su Google Cloud

L'app ha un server e un database PostgreSQL, quindi non può stare su GitHub Pages né su Firestore: su Google
gira con **Cloud Run** (il server, dall'immagine Docker di questo repository) e **Cloud SQL** (il database).
Si fa tutto dalla console di Google Cloud, nello stesso progetto e con la stessa fatturazione di Firebase.

1. **Progetto** – usa un progetto Google esistente o creane uno, con la fatturazione attiva (piano Blaze).
2. **Database** – Cloud SQL → crea un'istanza **PostgreSQL 16** nella regione più vicina (es. `europe-west8`,
   Milano), nel taglio più piccolo. Crea il database `omnia_marina` e un utente `omnia_marina` con una password
   robusta. Attiva i **backup automatici**.
3. **Server** – Cloud Run → crea un servizio con *deploy continuo da repository*: collega GitHub, scegli
   `omnia-marina`, ramo `main`, tipo di build **Dockerfile**. Stessa regione del database, accesso pubblico
   consentito (l'app ha il proprio login), porta `8080`, al massimo 2 istanze.
4. **Collegamento al database** – nel servizio Cloud Run aggiungi la connessione Cloud SQL all'istanza creata e
   imposta la variabile `DATABASE_URL` (meglio come segreto di Secret Manager):

   ```
   postgres://omnia_marina:PASSWORD@localhost/omnia_marina?host=/cloudsql/PROGETTO:REGIONE:ISTANZA
   ```

   `PROGETTO:REGIONE:ISTANZA` è il «nome connessione» mostrato nella pagina dell'istanza Cloud SQL. Se nei log
   compare un errore di permessi, assegna all'account di servizio del servizio il ruolo «Client Cloud SQL».
5. **Primo accesso** – apri l'indirizzo del servizio, vai su `/registrazione` e crea il porto. Poi imposta
   `ALLOW_SIGNUP=false` perché nessun altro possa registrare porti.

Da lì in poi ogni modifica caricata sul ramo `main` viene pubblicata da sola, e il database si aggiorna
all'avvio della nuova versione (`AUTO_MIGRATE=true`, già impostato nell'immagine). Per un indirizzo proprio
(es. `marina.tuodominio.it`) si collega il dominio al servizio Cloud Run.

Costi indicativi, da verificare sul listino Google: l'istanza Cloud SQL più piccola costa una decina di euro al
mese; Cloud Run si paga a consumo e per un solo porto resta in genere nella fascia gratuita.

L'immagine funziona anche fuori da Google, su qualsiasi server con Docker:

```bash
docker build -t omnia-marina .
docker run -p 8080:8080 -e DATABASE_URL=postgres://utente:password@host:5432/omnia_marina omnia-marina
```

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
- La foto della pianta dal vero è una sola per porto e i posti si dispongono a mano: non c'è riconoscimento
  automatico dei posti dall'immagine.
- L'app è installabile ma non funziona senza connessione.
- Il freno ai tentativi di accesso è in memoria: con più istanze del server va spostato su database o Redis.
