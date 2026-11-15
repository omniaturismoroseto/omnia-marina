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

### 1. Installa Google Cloud CLI

È il programma `gcloud`, l'equivalente di `firebase` per Google Cloud. Scarica l'installazione per Windows da
<https://cloud.google.com/sdk/docs/install> e lasciala con le opzioni predefinite. Alla fine chiudi e riapri
PowerShell.

### 2. Accedi con il tuo account Google

```powershell
gcloud auth login
```

Si apre il browser: scegli lo stesso account con cui hai creato il progetto.

### 3. Scarica il progetto

```powershell
cd "C:\Users\roset\Progetti"; git clone https://github.com/omniaturismoroseto/omnia-marina.git
```

Da qui in poi la cartella del progetto è `C:\Users\roset\Progetti\omnia-marina`.

---

## Pubblicare

Scarica le ultime modifiche e pubblica:

```powershell
cd "C:\Users\roset\Progetti\omnia-marina"; git pull origin main; gcloud run deploy omnia-marina --source . --region europe-west1 --project omnia-marina --quiet
```

Ci vogliono 5-10 minuti. Alla fine compare `Service URL: …`: la nuova versione è online.

- Google compila l'app sui suoi server: sul PC non serve installare altro.
- Il database non si tocca. Se la nuova versione porta modifiche al database, si applicano da sole all'avvio;
  se qualcosa va storto la nuova versione non parte e **resta online quella di prima**.
- Le impostazioni dell'app (collegamento al database, password, registrazione chiusa) restano quelle di prima.

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
