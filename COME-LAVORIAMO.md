# Come lavoriamo

Promemoria del modo di lavorare su Omnia Marina, lo stesso degli altri progetti: serve a non dover ricordare
a memoria i comandi e a evitare due versioni dello stesso file che si scontrano.

---

## Il principio

**GitHub sta al centro.** Claude lavora su una copia nel cloud e non può toccare il computer; il computer vede
le modifiche solo quando le scarica da GitHub.

| Dove | Cosa è | Si aggiorna |
|---|---|---|
| GitHub | la copia buona e tutta la storia | con `git push` |
| Il PC | da dove si pubblica su Google | con `git pull` |
| L'app online | quello che usano le persone | **solo** quando la pubblichi dal PC |

**A differenza delle pagine del sito, qui nulla va online da solo.** Una modifica che arriva su `main` è pronta,
ma l'app online cambia solo quando lanci il comando «Pubblicare».

L'app online: <https://omnia-marina-ldymep2ulq-ew.a.run.app>

---

## Chi fa cosa

**Claude scrive i file e li prova** nel suo ambiente (controlli automatici, test, prove nel browser) prima di
mandarli su `main`.

**Il PC fa due cose:**

1. `git pull`, per avere i file aggiornati;
2. la pubblicazione su Google.

**Se modifichi un file tu**, dillo e fai subito `push`.

---

## Una volta sola

Servono `git` e Google Cloud CLI (`gcloud`, l'equivalente di `firebase` per Google Cloud). Se `gcloud` mancasse:
<https://cloud.google.com/sdk/docs/install>, installazione per Windows con le opzioni predefinite.

### Scarica il progetto

Il progetto sta nella cartella `App Porto` sul Desktop, nella sottocartella `omnia-marina`. Se lì c'è già una
cartella `omnia-marina` estratta dallo zip, questo comando la rinomina in `omnia-marina-zip` (si può cancellare
dopo) e scarica al suo posto quella collegata a GitHub:

```powershell
cd "C:\Users\roset\OneDrive\Desktop\App Porto"; if ((Test-Path omnia-marina) -and -not (Test-Path omnia-marina\.git)) { Rename-Item omnia-marina omnia-marina-zip }; git clone https://github.com/omniaturismoroseto/omnia-marina.git
```

Da qui in poi la cartella del progetto è `C:\Users\roset\OneDrive\Desktop\App Porto\omnia-marina`.

### Accedi a Google, se `gcloud` lo chiede

```powershell
gcloud auth login
```

Si apre il browser: scegli lo stesso account con cui hai creato il progetto.

---

## Pubblicare

Prima si scaricano le ultime modifiche, poi si pubblica: se la pubblicazione partisse prima, andrebbero online i file
vecchi. Questo comando fa le due cose in ordine e **pubblica solo se lo scaricamento è riuscito**:

```powershell
cd "C:\Users\roset\OneDrive\Desktop\App Porto\omnia-marina"; git pull origin main; if ($LASTEXITCODE -eq 0) { gcloud run deploy omnia-marina --source . --region europe-west1 --project omnia-marina --quiet } else { Write-Host "git pull non riuscito: pubblicazione annullata" }
```

Se compare «git pull non riuscito», non è stato pubblicato niente: guarda «Quando qualcosa va storto» più sotto.

**Da Google Cloud Shell** (https://shell.cloud.google.com, la riga di comando nel browser: usa bash, non PowerShell, e il
progetto sta in `~/omnia-marina`) il comando unico è questo; anche qui pubblica solo se lo scaricamento è riuscito:

```bash
cd ~/omnia-marina && git pull origin main && gcloud run deploy omnia-marina --source . --region europe-west1 --project omnia-marina --quiet
```

Se Cloud Shell dice che la cartella `omnia-marina` non esiste, scaricala una volta con
`git clone https://github.com/omniaturismoroseto/omnia-marina.git ~/omnia-marina`.

Ci vogliono 5-10 minuti. Alla fine compare `Service URL: …`: la nuova versione è online.

- Google compila l'app sui suoi server: sul PC non serve installare altro.
- Il database non si tocca. Se la nuova versione porta modifiche al database, si applicano da sole all'avvio;
  se qualcosa va storto la nuova versione non parte e **resta online quella di prima**.
- Le impostazioni dell'app (collegamento al database, password, account manager) restano quelle di prima.

---

## Riconoscimento automatico dei pontili (una volta sola)

In Impostazioni → Pianta dal vero, il pulsante «Riconosci pontili e banchine» fa guardare la foto a Claude (Anthropic).
Si accende una volta, in uno dei due modi qui sotto. Ogni analisi costa indicativamente tra 10 e 30 centesimi, con un
limite di 20 analisi al giorno per porto.

### Con una chiave Anthropic (il modo in uso)

1. Su <https://console.anthropic.com> crea l'account (o entra), poi in **Settings → Billing** inserisci una carta e un
   credito iniziale (bastano pochi euro). In **Settings → Limits** puoi fissare una spesa massima al mese.
2. In **Settings → API keys** premi **Create key**, chiamala `omnia-marina` e **copiala**: viene mostrata una volta sola.
   Non incollarla in chat né in file del progetto.
3. Mettila nell'archivio dei segreti di Google: apri
   <https://console.cloud.google.com/security/secret-manager?project=omnia-marina>, premi **Crea secret**, nome
   `anthropic-api-key`, nel valore incolla la chiave, poi **Crea secret**.
4. Dai all'app il permesso di leggerla:

   ```powershell
   gcloud secrets add-iam-policy-binding anthropic-api-key --member "serviceAccount:omnia-marina-run@omnia-marina.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor --project omnia-marina
   ```

5. Collegala all'app (resta collegata anche nelle pubblicazioni successive):

   ```powershell
   gcloud run services update omnia-marina --update-secrets "ANTHROPIC_API_KEY=anthropic-api-key:latest" --region europe-west1 --project omnia-marina
   ```

Da quel momento il pulsante è attivo. Messaggi possibili:

- «La chiave Anthropic non è valida»: crea una nuova chiave, aggiungila al segreto `anthropic-api-key` come **nuova
  versione** (pulsante «Nuova versione» nella pagina del segreto) e ripeti il passo 5.
- «Il credito dell'account Anthropic è esaurito»: ricarica in **Settings → Billing**.

Per spegnerlo:

```powershell
gcloud run services update omnia-marina --remove-secrets ANTHROPIC_API_KEY --region europe-west1 --project omnia-marina
```

### In alternativa: Claude su Google Cloud (Vertex AI)

Tutto resta nel progetto Google e si paga sulla fatturazione Google, ma serve una **quota** che Google assegna a sua
discrezione: per i progetti con la fatturazione attivata da poco di solito la nega in automatico (è successo a
novembre 2026). Se in futuro la si vuole usare, senza chiave Anthropic collegata (la chiave ha la precedenza):

1. `gcloud services enable aiplatform.googleapis.com --project omnia-marina`
2. Nel Model Garden della console abilita **Claude Opus 5.5** (e, facoltativo, **Claude Opus 4.8**).
3. `gcloud projects add-iam-policy-binding omnia-marina --member "serviceAccount:omnia-marina-run@omnia-marina.iam.gserviceaccount.com" --role roles/aiplatform.user --condition=None`
4. `gcloud run services update omnia-marina --update-env-vars "ANTHROPIC_VERTEX_PROJECT_ID=omnia-marina,CLOUD_ML_REGION=global" --region europe-west1 --project omnia-marina`
5. In IAM e amministrazione → **Quote**, riga `global_online_prediction_requests_per_base_model` con
   `base_model: anthropic-claude-opus`, chiedi un aumento (per esempio 10 al minuto) e controlla l'esito nella scheda
   «Richieste di aumento».

## Accessi con Firebase (una volta sola)

Con Firebase Authentication le password le custodisce Google, e chi la dimentica se ne sceglie una nuova da solo con
«Password dimenticata?» nella pagina di accesso. Finché i passi qui sotto non sono fatti, l'app funziona come prima.
Nessuno deve cambiare la password: ognuno passa su Firebase da solo, al primo accesso, con la password che ha già.

Prima **pubblica la nuova versione** (vedi «Pubblicare»), poi:

1. Apri la [console di Firebase](https://console.firebase.google.com) → **Crea un progetto** → in basso scegli
   **«Aggiungi Firebase a un progetto Google Cloud esistente»** e seleziona `omnia-marina` (non crearne uno nuovo).
   Google Analytics non serve.
2. Menu **Build → Authentication → Inizia** → scheda **Metodo di accesso** → **Email/password** → attiva solo la prima
   levetta (non «Link via email») → **Salva**.
3. Scheda **Modelli**: in basso «Lingua dei modelli» → **Italiano**. Poi «Reimpostazione della password» → matita →
   **Nome mittente**: `Omnia Marina` → Salva.
4. Copia l'indirizzo dell'app:

   ```powershell
   gcloud run services describe omnia-marina --region europe-west1 --project omnia-marina --format "value(status.url)"
   ```

   Scheda **Impostazioni → Domini autorizzati → Aggiungi dominio**: incolla l'indirizzo **senza** `https://`.
5. Ingranaggio in alto a sinistra → **Impostazioni progetto** → **Generali** → copia la **Chiave API web**. Se non
   c'è, nella stessa pagina aggiungi un'app web (icona `</>`), nome `Omnia Marina`, senza Hosting, e ricomincia da qui.
6. Dai all'app il permesso di gestire gli account:

   ```powershell
   gcloud projects add-iam-policy-binding omnia-marina --member "serviceAccount:omnia-marina-run@omnia-marina.iam.gserviceaccount.com" --role roles/firebaseauth.admin --condition=None
   ```

7. Accendi Firebase nell'app (metti la chiave del passo 5 e l'indirizzo del passo 4, questa volta **con** `https://`):

   ```powershell
   gcloud run services update omnia-marina --update-env-vars "FIREBASE_PROJECT_ID=omnia-marina,FIREBASE_API_KEY=LA-CHIAVE,APP_URL=https://L-INDIRIZZO" --region europe-west1 --project omnia-marina
   ```

Per provare: esci, rientra con la tua password di sempre, poi da un'altra finestra prova «Password dimenticata?».
Gli account si vedono nella console di Firebase, Authentication → **Utenti**, man mano che le persone entrano.

Se l'accesso dice «Il servizio di accesso non risponde», guarda il registro dell'app (sezione «Controllare»): di solito
manca il permesso del passo 6 o la chiave del passo 5 è sbagliata.

**Non spegnere Firebase dopo averlo usato** (togliendo `FIREBASE_PROJECT_ID`): chi è già passato su Firebase non ha
più la password nell'app e non riuscirebbe a entrare finché la direzione non gli imposta una password provvisoria.

## Notifiche sul telefono per i diportisti (una volta sola)

Senza questi passi i messaggi del porto arrivano lo stesso nell'area diportista, ma senza la notifica sul telefono.
Servono due chiavi (una pubblica e una segreta). Si fa tutto da **Cloud Shell**: apri https://shell.cloud.google.com,
incolla i comandi uno alla volta.

1. Crea le chiavi e conserva la segreta in Secret Manager:

   ```bash
   KEYS=$(npx --yes web-push generate-vapid-keys --json); PUB=$(echo "$KEYS" | python3 -c "import json,sys;print(json.load(sys.stdin)['publicKey'])"); echo "$KEYS" | python3 -c "import json,sys;print(json.load(sys.stdin)['privateKey'],end='')" | gcloud secrets create vapid-private-key --data-file=- --project omnia-marina; echo "Chiave pubblica: $PUB"
   ```

2. Permesso all'app di leggerla:

   ```bash
   gcloud secrets add-iam-policy-binding vapid-private-key --project omnia-marina --member "serviceAccount:omnia-marina-run@omnia-marina.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor
   ```

3. Accendi le notifiche (nella **stessa** finestra di Cloud Shell, che ricorda `$PUB` dal passo 1):

   ```bash
   gcloud run services update omnia-marina --region europe-west1 --project omnia-marina --update-env-vars "VAPID_PUBLIC_KEY=$PUB" --update-secrets "VAPID_PRIVATE_KEY=vapid-private-key:latest"
   ```

Per provare: entra nell'area diportista da un telefono (con un invito di prova), apri «Messaggi» → «Attiva le notifiche»,
poi manda un messaggio a quel cliente dal gestionale. Su iPhone le notifiche funzionano solo dopo aver aggiunto l'app
alla schermata Home (Condividi → Aggiungi alla schermata Home) e averla aperta da lì.

Le chiavi non vanno cambiate: con chiavi nuove tutti i diportisti dovrebbero riattivare le notifiche.

## Avviso meteo automatico (facoltativo, una volta sola)

L'avviso (burrasca, tempesta o mare agitato vicino al porto, allerta arancione o rossa della Protezione Civile) compare
comunque in «Allerte», nel cruscotto e in banchina, da inviare con un clic. Per farlo partire da solo anche quando nessuno
guarda, Google controlla i bollettini ogni 3 ore. Sempre da **Cloud Shell**:

1. Crea la chiave del controllo e passala all'app:

   ```bash
   TOKEN=$(openssl rand -hex 24); printf %s "$TOKEN" | gcloud secrets create meteo-check-token --data-file=- --project omnia-marina; gcloud secrets add-iam-policy-binding meteo-check-token --project omnia-marina --member "serviceAccount:omnia-marina-run@omnia-marina.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor; gcloud run services update omnia-marina --region europe-west1 --project omnia-marina --update-secrets "METEO_CHECK_TOKEN=meteo-check-token:latest"
   ```

2. Programma il controllo ogni 3 ore (nella stessa finestra, che ricorda `$TOKEN`):

   ```bash
   gcloud services enable cloudscheduler.googleapis.com --project omnia-marina; URL=$(gcloud run services describe omnia-marina --region europe-west1 --project omnia-marina --format "value(status.url)"); gcloud scheduler jobs create http omnia-marina-meteo --location europe-west1 --project omnia-marina --schedule "7 */3 * * *" --time-zone "Europe/Rome" --uri "$URL/api/meteo/controllo" --http-method POST --headers "Authorization=Bearer $TOKEN"
   ```

3. Nell'app: **Impostazioni → Porto → Area diportisti e allerte** → spunta «Invia l'avviso meteo da solo» → Salva.

Per provarlo subito: `gcloud scheduler jobs run omnia-marina-meteo --location europe-west1 --project omnia-marina`.
Lo stesso avviso non parte due volte entro 24 ore. Per fermarlo: togli la spunta in Impostazioni, oppure
`gcloud scheduler jobs pause omnia-marina-meteo --location europe-west1 --project omnia-marina`.

---

## Cancellare i dati di prova (una volta sola)

Da **Cloud Shell** (https://shell.cloud.google.com):

```bash
cd ~/omnia-marina && git pull origin main && bash scripts/pulisci-prove.sh
```

Oppure dal PC, in PowerShell (lo lancia in Cloud Shell; la prima volta chiede di accettare la chiave: rispondi `y`):

```powershell
gcloud cloud-shell ssh --authorize-session --command "git clone https://github.com/omniaturismoroseto/omnia-marina.git ~/omnia-marina 2>/dev/null; cd ~/omnia-marina && git pull origin main && bash scripts/pulisci-prove.sh"
```

Mostra porto per porto che cosa cancella e chiede di scrivere `ELIMINA`; prima di cancellare fa un backup del database.
Via: contratti annullati e conclusi, scadenze e incassi di prova, prima nota e importazioni da Excel. Restano: bozze, contratti
attivi con le loro rate e i loro incassi (anche nella prima nota), clienti, barche, posti, listini e impostazioni.

## Controllare

### Che versione è online, e quando è stata pubblicata

```powershell
gcloud run revisions list --service omnia-marina --region europe-west1 --project omnia-marina --limit 5
```

### Il registro dell'app (se qualcosa non va)

```powershell
gcloud run services logs read omnia-marina --region europe-west1 --project omnia-marina --limit 50
```

Copia il risultato e mandalo a Claude.

---

## Quando qualcosa va storto

### Una nuova versione ha rotto qualcosa

Si torna indietro e si ripubblica. Serve il codice del commit, che Claude sa sempre dire:

```powershell
git revert --no-edit <codice-del-commit>; git push origin main
```

Poi il comando «Pubblicare».

### `index.lock: File exists`, o file «in conflitto» creati da OneDrive

La cartella sta dentro OneDrive, che a volte blocca o duplica i file di git mentre sincronizza. Aspetta che
OneDrive abbia finito, controlla che non ci sia un altro git in corso, poi:

```powershell
Remove-Item "C:\Users\roset\OneDrive\Desktop\App Porto\omnia-marina\.git\index.lock" -Force
```

Se succede spesso, conviene spostare il progetto fuori da OneDrive (per esempio in `C:\Users\roset\Progetti`):
è GitHub a conservare le copie, OneDrive non serve.

### `Deletion of directory '.git/objects/…' failed. Should I try again? (y/n)`

Durante il `git pull` git riordina i suoi file interni e OneDrive, che li sta sincronizzando, gli impedisce di
cancellare una cartella. Il progetto non corre rischi.

1. Metti in pausa OneDrive: icona della nuvola in basso a destra → ingranaggio → **Sospendi sincronizzazione** → 2 ore.
2. Scrivi `y` e premi Invio. Se chiede di nuovo, ancora `y`. Se continua a non riuscire, scrivi `n`: restano solo
   alcuni file vecchi inutili, non si perde niente.
3. Il comando prosegue da solo: finisce di scaricare e, con il comando unico, pubblica.

Perché non ricapiti, una volta sola, nella cartella del progetto (git smette di riordinare i file durante il `pull`):

```powershell
git config gc.auto 0; git config maintenance.auto false
```

### PowerShell dice che l'esecuzione di script è disabilitata

Scrivi `gcloud.cmd` al posto di `gcloud` nei comandi.

### Errore `PERMISSION_DENIED` o richiesta di accesso

L'accesso di `gcloud` è scaduto: rifai `gcloud auth login`.

---

## Cosa NON passa dal PC

| Cosa | Dove si gestisce |
|---|---|
| Dati (clienti, contratti, incassi, foto della pianta) | vivono nel database su Google, non nel repository |
| Utenti e ruoli | dall'app, in Impostazioni → Utenti |
| Nuovi porti e loro direttori | li crea solo l'account manager, da «Dove vuoi entrare?» |
| Account manager | variabile `ACCOUNT_MANAGER_EMAILS` del servizio, sotto |

L'**account manager** entra in tutti i porti scegliendo ogni volta il ruolo con cui provarli (Direzione, Ufficio,
Banchina, oppure Diportista di un cliente a scelta, senza segnare messaggi come letti), è l'unico che crea i porti (con il loro
direttore e una password provvisoria) e nei porti non compare: né tra gli utenti, né nel registro delle operazioni,
né accanto a incassi, movimenti, consensi, segnalazioni e messaggi. Si riconosce dall'email, che sta in una
variabile del servizio (non nel codice). L'account con quell'email deve già esistere: nessuno può crearne uno nuovo
con la stessa email. Per impostarla (una volta sola; più email separate da virgole), sostituendo `LA-TUA-EMAIL`:

```powershell
gcloud run services update omnia-marina --update-env-vars ACCOUNT_MANAGER_EMAILS=LA-TUA-EMAIL --region europe-west1 --project omnia-marina
```

La registrazione da `/registrazione` funziona solo alla prima installazione, quando non c'è ancora nessun porto.

Per creare tutto da zero su un altro progetto, o cancellare tutto e fermare i costi, c'è
`scripts/pubblica-google.sh`, da usare in Google Cloud Shell (vedi il README).
