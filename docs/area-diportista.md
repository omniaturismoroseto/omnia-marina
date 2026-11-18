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

Stato: passo 1 (Firebase e «Password dimenticata?») e passo 2 (inviti, attivazione, revoca) **fatti**, e la prima
versione dell'area (vedi «Funzioni dell'area» in fondo).

### 1. L'ufficio invita
Scheda cliente → **«Accesso all'app»** → «Invita una persona»: un nome (il titolare è proposto dalla scheda; si può
scrivere quello di un familiare o di uno skipper). L'app crea un **invito** valido 30 giorni e utilizzabile una sola
volta, con un **codice di 8 caratteri** (senza caratteri ambigui come 0/O e 1/I). Il codice si consegna:
- con il **foglio di benvenuto** stampabile (codice, QR code e istruzioni), insieme al contratto;
- oppure copiando un messaggio già pronto (WhatsApp, SMS, email dell'ufficio) con il collegamento `/attiva/<codice>`.
  Il pulsante «WhatsApp» apre la chat con il telefono della scheda, se c'è.

Il codice resta **leggibile all'ufficio** finché l'invito è in attesa, così il foglio si può ristampare. Da solo non
basta: serve anche il codice fiscale o la partita IVA. Dopo 5 tentativi sbagliati l'invito si blocca. All'attivazione
l'invito si cancella.

### 2. Il diportista attiva l'accesso
Su `/attiva` (o dal QR o dal collegamento, che compilano il codice) inserisce:
1. il codice e, come seconda prova, il **codice fiscale o la partita IVA** del cliente presente nella scheda;
2. email e password: l'app crea l'account su Firebase e Firebase invia l'**email di conferma dell'indirizzo**.

L'area diportista si apre solo dopo che l'email è stata confermata. Il codice, intanto, è già usato. Se si prova ad
accedere senza aver confermato, Firebase rimanda l'email di conferma.
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

### Spostare gli account di oggi (fatto: passo 1)
Non c'è un'importazione in blocco: ogni account passa su Firebase **da solo**, con lo stesso identificativo
(`users.id` = uid Firebase):
- al primo accesso riuscito con la password di oggi, che viene verificata nell'app e poi data a Firebase;
- oppure alla prima richiesta di «Password dimenticata?» (l'account nasce su Firebase e l'email fa scegliere la password);
- oppure quando la direzione imposta una password provvisoria o la persona la cambia dal proprio account.

Dopo il passaggio `users.password_hash` resta vuota. Si potrà togliere la colonna quando tutti saranno passati.
Una nuova password scelta dal collegamento dell'email non chiude le sessioni già aperte, che scadono da sole dopo 30
giorni. Le chiude invece il cambio dal proprio account o la password provvisoria della direzione.

## Modello dei dati (proposta)

- `users`: aggiunge `firebase_uid` (unico), e `password_hash` diventa facoltativa (fatto). `email_verified` si legge da Firebase.
- `owner_invites` (fatto): porto, cliente, nome, codice (unico), scadenza, tentativi sbagliati, creato da.
- `owner_access` (fatto): porto, cliente, utente, creato il, creato da, revocato il, ultimo ingresso. Ha un vincolo
  unico (cliente, utente): un nuovo invito alla stessa persona riattiva l'accesso revocato.
- `sessions` (fatto): aggiunge `owner_access_id`. Se è valorizzato, la sessione è nell'area diportista e
  `requireMarina` la rimanda a `/diportista`.
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

## Funzioni dell'area

Fatte (prima versione):
- **La mia barca** (`/diportista`): posto e pontile, contratto attivo da scaricare (stesso documento della stampa
  dell'ufficio), scadenze (rate da pagare, fine contratto entro 60 giorni, assicurazione entro 30), barche, contatti e
  orari del porto, informazioni utili, contratti passati. **Estratto conto** su `/diportista/conto`.
- **Messaggi** (`/messaggi` per il personale, `/diportista/messaggi` per il diportista): a un cliente, a un pontile,
  a un tipo di contratto, a chi è in porto o a tutti; urgenti in evidenza finché non letti; chi ha letto e quando;
  notifiche web push (chiavi VAPID, vedi COME-LAVORIAMO.md).
- **Meteo e mare** (`/diportista/meteo`; per il personale `/meteo`, cruscotto e banchina): vento con forza Beaufort,
  onda e stato del mare, mare lungo, corrente, livello del mare, bollettino di criticità della Protezione Civile per la
  zona del porto; avviso per burrasca, raffiche od onda oltre soglia o allerta arancione/rossa, con un clic o in
  automatico ogni 3 ore (Cloud Scheduler). Gli avvisi di burrasca dell'Aeronautica Militare non sono pubblicati in
  forma leggibile dall'app: la burrasca si calcola dalle previsioni, con il rimando agli avvisi ufficiali.

In lista per dopo:
- Richieste e segnalazioni dal diportista (con foto), collegate alle segnalazioni della banchina.
- «Esco in mare / rientro alle…» e assenze lunghe (posto libero per i transiti).
- Promemoria automatici delle scadenze (rate, assicurazione) come notifiche.
- Caricamento della nuova polizza dal telefono.
- Pagamento online, prenotazione dei servizi, ospiti.
- Telecamere (da decidere: condivisione DMSS oppure piccolo computer in porto con go2rtc e tunnel sicuro).
