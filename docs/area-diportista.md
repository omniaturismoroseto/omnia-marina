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
- **L'app invia email** (invito, conferma dell'indirizzo, password dimenticata) con un servizio di invio esterno.

## Percorsi

### 1. L'ufficio invita
Scheda cliente → **«Accesso all'app»** → «Invita una persona»: nome ed email (proposti dalla scheda del cliente, ma
modificabili per un familiare o uno skipper). L'app:
- crea un **invito** valido 30 giorni e utilizzabile una sola volta, con un **codice di 8 caratteri** (senza caratteri
  ambigui come 0/O e 1/I);
- invia all'email indicata il messaggio «Il porto X ti invita nell'app», con il pulsante che apre `/attiva/<codice>`;
- permette di **stampare il foglio di benvenuto** (codice e QR code) da consegnare insieme al contratto, oppure di copiare
  il codice in un messaggio, per chi non legge le email.

### 2. Il diportista attiva l'accesso
- **Dal link nell'email:** il diportista sceglie la password ed è dentro. L'indirizzo è già confermato, perché ha aperto
  il link ricevuto lì.
- **Dal codice su carta:** su `/attiva` inserisce il codice e, come seconda prova, il **codice fiscale o la partita IVA**
  del cliente presente nella scheda. Poi sceglie email e password e riceve un **codice di conferma di 6 cifre** per
  verificare l'indirizzo.
- Se l'email ha già un account (per esempio un dipendente che ha anche la barca nel porto), non se ne crea un altro:
  chiede la password che usa già e collega l'accesso al suo account.

### 3. Entrare
- Si entra dallo stesso `/login`. Chi ha solo l'accesso da diportista va direttamente nella sua area (`/diportista`).
  Chi è anche personale di un porto, o ha barche in più porti, sceglie dalla pagina dei porti dove entrare.
- Valgono gli stessi limiti di oggi contro i tentativi ripetuti, più un limite sui tentativi con codici sbagliati in `/attiva`.

### 4. Password dimenticata
`/password-dimenticata`: si inserisce l'email e arriva un link valido 1 ora, utilizzabile una sola volta. Il messaggio a
schermo è sempre lo stesso, che l'email esista o no. Cambiare la password chiude tutte le altre sessioni aperte.
Il link vale anche per il personale del porto.

### 5. Il porto tiene il controllo
Nella scheda cliente, sezione «Accesso all'app»:
- persone con accesso: nome, email, data di attivazione, ultimo ingresso → **Revoca** (chiude subito le sessioni aperte);
- inviti in attesa: email, scadenza → **Invia di nuovo** (nuovo codice: quello vecchio smette di valere) o **Annulla**.

Inviti, attivazioni e revoche finiscono nel registro attività. Un cliente eliminato si porta via accessi e inviti.

## Modello dei dati (proposta)

- `users`: aggiunge `email_verified_at`.
- `owner_invites`: porto, cliente, nome, email, hash del codice, scadenza, usato il, creato da, inviato il.
- `owner_access`: porto, cliente, utente, creato il, creato da, revocato il, ultimo ingresso. Ha un vincolo unico
  (cliente, utente).
- `email_tokens`: utente o email, scopo (`conferma` | `password`), hash del token, scadenza, usato il.
- `sessions`: aggiunge `owner_access_id`. Se è valorizzato, la sessione è nell'area diportista.
- Codici e token si salvano solo come hash SHA-256, come le sessioni.
- Nuovo controllo `requireOwner()` (gemello di `requireMarina`): restituisce porto e cliente della sessione, verifica
  che l'accesso non sia revocato, e ogni lettura filtra per `ownerId` **e** `marinaId`.

## Email

- Servizio di invio esterno, chiamato con un modulo `src/server/mail.ts`. La chiave API si tiene in Secret Manager e
  arriva come variabile d'ambiente, come quella di Anthropic.
- Mittente `noreply@<dominio dell'app>`; «rispondi a» è l'email del porto (`marinas.email`). Il nome del porto compare
  nell'oggetto e nel testo.
- Il dominio va verificato presso il servizio aggiungendo i record DNS (SPF, DKIM), altrimenti le email finiscono
  nello spam.
- Senza chiave configurata (sviluppo locale) le email non partono: si scrivono nel log del server.

## Da decidere

- Servizio di invio email e dominio mittente.
