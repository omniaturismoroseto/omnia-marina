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

Il marchio (logo con la scritta e solo simbolo, a colori e in negativo per gli sfondi scuri) è nella cartella
[`marchio/`](marchio/), a piena risoluzione.

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

In alternativa ai passi 3 e 4, **«Riconosci pontili e banchine»** fa analizzare la foto a Claude (su Vertex AI di Google):
propone ogni pontile e banchina con nome, posti per lato e misura delle barche; si correggono i dati, si spostano le
estremità sulla foto e con un clic nascono pontili e posti già disposti. Si attiva una volta con i passi in
[COME-LAVORIAMO.md](COME-LAVORIAMO.md); senza attivazione il resto della pianta funziona comunque.

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

L'app è pubblicata su <https://omnia-marina-ldymep2ulq-ew.a.run.app> (progetto Google `omnia-marina`,
regione `europe-west1`). **Gli aggiornamenti si pubblicano dal PC: i comandi sono in
[COME-LAVORIAMO.md](COME-LAVORIAMO.md).** Le istruzioni qui sotto servono solo per creare tutto da zero.

L'app ha un server e un database PostgreSQL, quindi non può stare su GitHub Pages né su Firestore: su Google
gira con **Cloud Run** (il server, dall'immagine Docker di questo repository) e **Cloud SQL** (il database),
nello stesso account e con la stessa fatturazione di Firebase.

### Con lo script (consigliato)

Serve un progetto Google con la fatturazione attiva (piano Blaze) di cui si è proprietari.

1. Apri **Google Cloud Shell**: <https://shell.cloud.google.com>. È un terminale nel browser, già collegato
   al tuo account Google.
2. Carica lo zip del progetto: menu **⋮** in alto a destra del terminale → **Carica**.
3. Incolla questo comando e premi Invio:

   ```bash
   unzip -o omnia-marina.zip && cd omnia-marina && bash scripts/pubblica-google.sh
   ```

4. Scegli il progetto, conferma con `si` e attendi una ventina di minuti. Lo script crea il database (con
   backup giornalieri), genera una password che resta solo in Secret Manager, compila l'app e la pubblica;
   alla fine stampa l'indirizzo.
5. Apri l'indirizzo, vai su `/registrazione` e crea il porto. Subito dopo chiudi la registrazione:

   ```bash
   bash scripts/pubblica-google.sh chiudi-registrazione
   ```

Per **aggiornare** l'app a una nuova versione: carica il nuovo zip e rilancia lo stesso comando del punto 3.
Il database non viene toccato, se non per applicare le eventuali migrazioni all'avvio (`AUTO_MIGRATE=true`).

| Comando | Cosa fa |
|---|---|
| `bash scripts/pubblica-google.sh` | Pubblica, oppure aggiorna alla versione della cartella |
| `bash scripts/pubblica-google.sh stato` | Indirizzo dell'app, stato del database e della registrazione |
| `bash scripts/pubblica-google.sh registro` | Ultime righe del registro dell'app, utili se qualcosa non va |
| `bash scripts/pubblica-google.sh elimina` | Cancella app, database e dati, e ferma ogni costo |

La regione predefinita è `europe-west1` (Belgio); per un'altra: `REGIONE=europe-west8 bash scripts/pubblica-google.sh`.

Costi indicativi, da verificare sul listino Google: l'istanza Cloud SQL più piccola (`db-f1-micro`) costa una
decina di euro al mese finché esiste; Cloud Run si paga a consumo e per un solo porto resta in genere nella
fascia gratuita.

### A mano dalla console

Gli stessi passi si possono fare dalla console di Google Cloud:

1. **Database** – Cloud SQL → istanza **PostgreSQL 16**, edizione Enterprise, taglio più piccolo, backup
   automatici attivi. Crea il database `omnia_marina` e un utente `omnia_marina` con una password robusta.
2. **Server** – Cloud Run → nuovo servizio con *deploy continuo da repository*: collega GitHub, scegli
   `omnia-marina`, ramo `main`, tipo di build **Dockerfile**. Stessa regione del database, accesso pubblico
   consentito (l'app ha il proprio login), porta `8080`, al massimo 2 istanze.
3. **Collegamento** – nel servizio aggiungi la connessione Cloud SQL all'istanza e la variabile `DATABASE_URL`
   (meglio come segreto di Secret Manager), dove `PROGETTO:REGIONE:ISTANZA` è il «nome connessione» dell'istanza:

   ```
   postgres://omnia_marina:PASSWORD@localhost/omnia_marina?host=/cloudsql/PROGETTO:REGIONE:ISTANZA
   ```

   L'account di servizio dell'app deve avere il ruolo «Client Cloud SQL» e l'accesso al segreto.
4. **Primo accesso** – `ALLOW_SIGNUP=true` per registrare il porto da `/registrazione`, poi `ALLOW_SIGNUP=false`.

Con il deploy continuo ogni modifica caricata sul ramo `main` viene pubblicata da sola.

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
scripts/             migrazioni, dati dimostrativi e pubblicazione su Google
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
