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

Ci vogliono 5-10 minuti. Alla fine compare `Service URL: …`: la nuova versione è online.

- Google compila l'app sui suoi server: sul PC non serve installare altro.
- Il database non si tocca. Se la nuova versione porta modifiche al database, si applicano da sole all'avvio;
  se qualcosa va storto la nuova versione non parte e **resta online quella di prima**.
- Le impostazioni dell'app (collegamento al database, password, registrazione chiusa) restano quelle di prima.

---

## Riconoscimento automatico dei pontili (una volta sola)

In Impostazioni → Pianta dal vero, il pulsante «Riconosci pontili e banchine» fa guardare la foto a Claude (Anthropic),
attraverso Vertex AI di Google: tutto resta nel progetto `omnia-marina` e si paga sulla fatturazione Google, senza
account o chiavi in più. Va acceso una volta, dopo aver pubblicato una versione che lo contiene.

1. Attiva il servizio Vertex AI nel progetto:

   ```powershell
   gcloud services enable aiplatform.googleapis.com --project omnia-marina
   ```

2. Abilita il modello **Claude Opus 5.5**: apri
   <https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-opus-5-5?project=omnia-marina>
   (oppure cerca «Model Garden» nella console e poi «Claude Opus 5.5»), premi **Abilita** e accetta le condizioni.
   Facoltativo: fai lo stesso con **Claude Opus 4.8**, che l'app usa solo nel caso raro in cui Opus 5.5 rifiuti una foto.

3. Dai all'app il permesso di usarlo:

   ```powershell
   gcloud projects add-iam-policy-binding omnia-marina --member "serviceAccount:omnia-marina-run@omnia-marina.iam.gserviceaccount.com" --role roles/aiplatform.user --condition=None
   ```

4. Accendilo nell'app:

   ```powershell
   gcloud run services update omnia-marina --update-env-vars "ANTHROPIC_VERTEX_PROJECT_ID=omnia-marina,CLOUD_ML_REGION=global" --region europe-west1 --project omnia-marina
   ```

Da quel momento il pulsante è attivo. Ogni analisi costa indicativamente tra 10 e 30 centesimi (una foto e la
risposta), con un limite di 20 analisi al giorno per porto. Per spegnerlo:

```powershell
gcloud run services update omnia-marina --remove-env-vars ANTHROPIC_VERTEX_PROJECT_ID --region europe-west1 --project omnia-marina
```

Se l'app dice che Google ha rifiutato la richiesta, quasi sempre manca il passo 2 o il passo 3.

Se l'app dice che la **quota** è esaurita o non assegnata: nella console apri IAM e amministrazione → **Quote**, cerca
«claude-opus-5-5», seleziona le righe della località `global` (richieste al minuto e token al minuto) e chiedi un
aumento, per esempio 10 richieste e 100.000 token al minuto. Di solito Google risponde entro qualche giorno.

---

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
| Registrazione di nuovi porti | resta chiusa; per riaprirla, sotto |

Riaprire o chiudere la registrazione di nuovi porti:

```powershell
gcloud run services update omnia-marina --update-env-vars ALLOW_SIGNUP=true --region europe-west1 --project omnia-marina
```

```powershell
gcloud run services update omnia-marina --update-env-vars ALLOW_SIGNUP=false --region europe-west1 --project omnia-marina
```

Per creare tutto da zero su un altro progetto, o cancellare tutto e fermare i costi, c'è
`scripts/pubblica-google.sh`, da usare in Google Cloud Shell (vedi il README).
