# Area diportista — accesso

Come una persona ottiene l'accesso all'area diportista e come il porto lo controlla. È la base delle funzioni
successive (contratto, pagamenti, documenti, telecamere).

## Principi

- **Non ci si iscrive da soli: invita il porto.** Ogni accesso nasce dalla scheda di un cliente, quindi è sempre
  collegato al cliente giusto. La registrazione libera (`/registrazione`) resta solo per creare porti.
- **Più persone per cliente.** Titolare, familiari, skipper, persone di una società: ognuna ha il proprio accesso
  con nome ed email propri e si revoca senza toccare le altre.
- **Si può invitare qualsiasi cliente.** Le telecamere si vedono solo con un contratto attivo. Un ex cliente continua a
  vedere contratti e pagamenti passati, ma non le telecamere.
- **Area separata dal gestionale.** Un diportista non ha ruoli nel porto e non può aprire nessuna pagina del
  gestionale. Vede solo i dati del proprio cliente.
- **Gli accessi li gestisce Firebase Authentication** (Google), per tutti: diportisti e personale del porto. Firebase
  custodisce email e password e invia lui le email di conferma dell'indirizzo e di password dimenticata. Non serve un
  servizio di invio email. Si accede solo con email e password (niente «Accedi con Google», per ora).
- **I dati restano nel database dell'app.** Firebase sa solo chi è la persona; porti, ruoli, clienti e accessi da
  diportista stanno in PostgreSQL come oggi.

## Percorsi

### 1. L'ufficio invita
Scheda cliente → **«Accesso all'app»** → «Invita una persona»: un nome (il titolare è proposto dalla scheda; si può
scrivere quello di un familiare o di uno skipper). L'app crea un **invito** valido 30 giorni e utilizzabile una sola
volta, con un **codice di 8 caratteri** (senza caratteri ambigui come 0/O e 1/I). Il codice si consegna:
- con il **foglio di benvenuto** stampabile (codice, QR code e istruzioni), insieme al contratto;
- oppure copiando un messaggio già pronto (WhatsApp, SMS, email dell'ufficio) con il collegamento `/attiva/<codice>`.

### 2. Il diportista attiva l'accesso
Su `/attiva` (o dal QR o dal collegamento, che compilano il codice) inserisce:
1. il codice e, come seconda prova, il **codice fiscale o la partita IVA** del cliente presente nella scheda;
2. email e password: l'app crea l'account su Firebase e Firebase invia l'**email di conferma dell'indirizzo**.

L'area diportista si apre solo dopo che l'email è stata confermata. Il codice, intanto, è già usato.
Se l'email ha già un account (per esempio un dipendente che ha anche la barca nel porto), non se ne crea un altro:
chiede la password che usa già e collega l'accesso a quell'account.

### 3. Entrare
- Si entra dallo stesso `/login`. Chi ha solo l'accesso da diportista va direttamente nella sua area (`/diportista`).
  Chi è anche personale di un porto, o ha barche in più porti, sceglie dalla pagina dei porti dove entrare.
- Valgono gli stessi limiti di oggi contro i tentativi ripetuti, più un limite sui tentativi con codici sbagliati in `/attiva`.

### 4. Password dimenticata
Il link «Password dimenticata?» sotto il login fa inviare a Firebase l'email per reimpostarla. Il messaggio a schermo è
sempre lo stesso, che l'email esista o no. Vale per tutti, personale compreso. La direzione può ancora impostare una
password provvisoria a chi lavora solo nel suo porto (Impostazioni → Utenti), come oggi.

### 5. Il porto tiene il controllo
Nella scheda cliente, sezione «Accesso all'app»:
- persone con accesso: nome, email, data di attivazione, ultimo ingresso → **Revoca** (chiude subito le sessioni aperte);
- inviti in attesa: email, scadenza → **Invia di nuovo** (nuovo codice: quello vecchio smette di valere) o **Annulla**.

Inviti, attivazioni e revoche finiscono nel registro attività. Un cliente eliminato si porta via accessi e inviti.

## Firebase: come si collega

- **Accesso:** i moduli restano azioni server, come oggi. Il server verifica email e password con l'API di Firebase
  Authentication e, se vanno bene, apre la **sessione dell'app** di sempre (cookie e tabella `sessions`), con gli stessi
  limiti contro i tentativi ripetuti. Il resto dell'app (`requireMarina`) non cambia.
- **Operazioni del porto** (creare il personale, password provvisoria, chiudere le sessioni, revoche) con
  `firebase-admin`. Su Cloud Run usa l'account di servizio del progetto, quindi non serve nessuna chiave da custodire.
- **Configurazione:** progetto Firebase sullo stesso progetto Google Cloud `omnia-marina`, Authentication con il solo
  provider «Email/password», modelli delle email in italiano, dominio dell'app tra i domini autorizzati. La chiave web
  pubblica di Firebase è una variabile d'ambiente (non è un segreto).
- **Sviluppo e test:** l'emulatore di Firebase Authentication. Nell'anteprima, nessuna chiamata a Firebase vero.

### Spostare gli account di oggi
Le password attuali sono in scrypt (N=2^15, r=8, p=3, chiave da 64 byte, sale per utente), un formato che Firebase
importa (`STANDARD_SCRYPT`). Uno script importa una volta tutti gli utenti con lo **stesso identificativo**, così il
personale entra con la password che ha già. Se un account non si importasse, la persona usa «Password dimenticata?».
Dopo l'importazione la colonna `users.password_hash` non serve più e si toglie con una migrazione successiva.

## Modello dei dati (proposta)

- `users`: aggiunge `firebase_uid` (unico). `email_verified` si legge da Firebase.
- `owner_invites`: porto, cliente, nome, hash del codice, scadenza, usato il, creato da.
- `owner_access`: porto, cliente, utente, creato il, creato da, revocato il, ultimo ingresso. Ha un vincolo unico
  (cliente, utente).
- `sessions`: aggiunge `owner_access_id`. Se è valorizzato, la sessione è nell'area diportista.
- Codici e token si salvano solo come hash SHA-256, come le sessioni.
- Nuovo controllo `requireOwner()` (gemello di `requireMarina`): restituisce porto e cliente della sessione, verifica
  che l'accesso non sia revocato, e ogni lettura filtra per `ownerId` **e** `marinaId`.

## Email

Le invia Firebase, da `noreply@omnia-marina.firebaseapp.com`, con i modelli in italiano impostati nella console
(nome mittente «Omnia Marina»). In seguito si può usare un dominio proprio aggiungendo i record DNS che Firebase indica.
Il porto non invia altre email: l'invito viaggia con il codice.

## Prima di cominciare (da fare nella console, una volta)

1. Aggiungere Firebase al progetto Google Cloud `omnia-marina`.
2. Authentication → attivare il provider «Email/password».
3. Authentication → Modelli: lingua italiana, nome mittente «Omnia Marina».
4. Authentication → Impostazioni → Domini autorizzati: aggiungere l'indirizzo dell'app su Cloud Run.
5. Impostazioni progetto → copiare la chiave web pubblica, che diventa una variabile di Cloud Run.
