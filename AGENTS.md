<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Convenzioni del progetto

- Lingua: interfaccia, messaggi e commenti in italiano; identificatori del codice in inglese.
- Ogni pagina è `export default page(async function …)` (vedi `src/components/page.tsx`): il contenuto legge
  sessione e dati dietro `<Suspense>`, come richiesto da Cache Components.
- Ogni pagina e ogni azione server inizia con `requireMarina(ruoli)` e filtra **sempre** per `ctx.marinaId`.
  Gli identificativi che arrivano dal browser vanno verificati contro il porto della sessione.
- Le regole del porto stanno in `src/server/contracts.ts` e `src/server/accounting.ts` (funzioni che ricevono la
  transazione); le azioni in `src/server/*-actions.ts` fanno solo permessi, validazione e `revalidatePath`.
- Le azioni dei moduli hanno firma `(prev, formData) => Promise<FormState>` e validano con `parseForm` (`src/lib/forms.ts`).
- Importi in centesimi, misure in centimetri, date di calendario come stringhe `AAAA-MM-GG` (`src/lib/dates.ts`).
- Nelle select Drizzle su una sola tabella le colonne interpolate in `sql` escono senza nome di tabella: nelle
  sottoquery correlate scrivere il riferimento esterno per esteso (es. `"owners"."id"`).
- Tariffe: una riga di `rates` per listino × categoria × zona (`zone_id` vuoto = tariffa base, vincolo unico NULLS NOT DISTINCT);
  la zona sta sul pontile (`piers.tariff_zone_id`) e `zoneRate` (`src/lib/pricing.ts`) unisce zona e base campo per campo. `rates.waste` non entra nel canone: precompila la voce «rifiuti» degli annuali.
- Marchio: originali (a colori e in negativo per sfondi scuri) in `marchio/`, anche in orizzontale (`omnia-marina-logo-orizzontale*.png`,
  composto dai pezzi del logo verticale); per l'interfaccia `src/components/brand.tsx` con le immagini di `src/assets/brand/` (già alla
  misura giusta, `unoptimized`): `BrandWide` in alto nel menu, `BrandLogo` nelle pagine di accesso. Icone in `src/app` (favicon, icon,
  apple-icon) e `public/`. Nome dell'app installata: «Omnia Marina Gestionale» (`src/app/manifest.ts` e metadati in `src/app/layout.tsx`).
- Logo della società di gestione: caricato da Impostazioni → Porto, salvato in `marina_logos` (PNG/JPEG, mai SVG) e servito da
  `/logo?v=<marinas.logo_version>`; `portLogo` (`src/lib/logo.ts`) e `PortLogo`/`PortLogoTile` (`src/components/port-logo.tsx`) lo mostrano
  nel menu (su riquadro bianco) e nelle intestazioni di contratto e informativa. Il logo di Omnia Marina resta quello dell'app.
- Importazione clienti (`/clienti/importa`): il file si legge nel browser (`readXlsx`); analisi, pulizia e raggruppamento sono
  funzioni pure in `src/lib/owner-import.ts` (con `fiscal.ts` e `provinces.ts`), il salvataggio in `src/server/owner-import.ts`
  (`importOwners` rifà i controlli bloccanti, `undoOwnerImport` toglie solo ciò che non è stato usato). I clienti già presenti
  (stesso CF, P.IVA o, senza codici, stesso nome) si completano solo nei campi vuoti; ogni riga creata porta `import_id`.
- Categoria «ex cliente»: `owners.former`, nome in `marinas.former_owner_label` (Impostazioni → Porto). Solo per chi non ha un
  contratto attivo (`setOwnerFormer`); attivare un contratto la toglie (`clearFormer` in `src/server/contracts.ts`). L'elenco
  clienti normale e il conteggio «Informativa mancante» escludono gli ex clienti.
- Guida (`/guida`, voce di menu per tutti i ruoli): i testi stanno in `src/lib/guide.ts`, una sezione per voce di menu con i ruoli
  che la vedono; `PageHeader help="<id>"` mette accanto al titolo il collegamento alla sezione. Quando cambiano pulsanti, percorsi
  o regole visibili all'utente, aggiornare anche la guida (`tests/guide.test.ts` controlla ancore e collegamenti).
- Pianta dal vero: le coordinate dei posti (`berths.plan_x/plan_y/plan_angle`) sono in pixel della foto caricata;
  la geometria sta in `src/lib/plan.ts`, la foto nel database (`marina_plans`) ed è servita da `/pianta/immagine`.
  La mappa ha tre viste: «Pianta disegnata» (predefinita), «Foto» e «Schema» (`?vista=foto|schema`), tutte in `PlanView`
  (`src/app/(app)/mappa/plan-view.tsx`). La pianta disegnata ricava passerelle e verso delle barche dai posti disposti
  (`pierLayout` in `src/lib/plan-drawing.ts`) e la forma di terra, moli e dighe da `marina_plans.drawing`, che Claude ricava
  dalla foto (`drawPlanFromPhoto`, stesso limite giornaliero dell'analisi; collaudi con `PLAN_DRAWING_FIXTURE`).
- Numerazione dei contratti: le bozze non hanno numero (`seq`/`number` vuoti, in stampa «BOZZA»); il numero nasce all'attivazione
  ed è il più basso libero dell'anno (`src/lib/contract-numbers.ts`, `assignContractNumber`). «Torna in bozza» (`revertToDraft`) libera
  numero e addebiti mai incassati; i buchi (`contractNumberGaps`) si segnalano in elenco contratti e cruscotto finché non vengono ripresi.
  Solo le bozze si modificano (`/contratti/[id]/modifica`, `updateDraftContract`). Mostrare i numeri con `contractNumberLabel`.
- Contratto stampato (`/contratti/[id]/stampa`): gli articoli 1-3 (oggetto, canone, spese) li compone la pagina con i dati
  del contratto; dal 4 in poi stampa `marinas.contract_terms`, poi l'approvazione specifica `marinas.contract_approval_text`
  (modelli in `src/lib/contract-texts.ts`). Spazi a terra, posti auto, carrello e spese fisse sono `contract_items`, ognuna con
  il proprio addebito (`src/server/contracts.ts`). Le voci `servizio` (cauzioni e altri servizi presi dal listino con
  `src/server/list-extras.ts`) hanno descrizione e aliquota propria (`vat_rate` 0 = senza IVA) e possono essere più d'una.
- Riconoscimento automatico: `src/server/plan-ai.ts` chiama Claude (`claude-opus-5-5`). Con `ANTHROPIC_API_KEY` (in produzione dal
  segreto `anthropic-api-key` di Secret Manager) usa l'API Anthropic diretta, con `fallbacks: "default"` lato server; altrimenti, con
  `ANTHROPIC_VERTEX_PROJECT_ID` (+ `CLOUD_ML_REGION`, predefinito `global`), Vertex AI con `AnthropicVertex` (Google ha negato la quota). La conversione della risposta
  in proposte è in `src/lib/plan-analysis.ts`. Per i collaudi locali `PLAN_ANALYSIS_FIXTURE` (percorso di un JSON) sostituisce
  la chiamata: non metterlo nel `.env` dell'anteprima, e ricompilare dopo averlo tolto (la build copia `.env` in `.next/standalone`).
- Accessi: email e password passano da `src/server/credentials.ts` (`verifyLogin`, `createAccount`, `setPassword`,
  `checkPassword`, `requestPasswordReset`), mai direttamente da `users.password_hash`. Con `FIREBASE_PROJECT_ID` decide
  Firebase Authentication (password ed email di «password dimenticata»; `firebase-admin` per le operazioni del porto,
  API REST con `FIREBASE_API_KEY` per l'accesso); senza, valgono le password locali. Un account locale passa su Firebase
  da solo (stesso uid = `users.id`) al primo accesso riuscito o alla prima richiesta di nuova password. Dopo l'accesso
  la sessione resta quella dell'app (`src/lib/auth/session.ts`). Test: `tests/credentials.test.ts` con l'emulatore
  (`npx firebase-tools emulators:start --only auth --project demo-omnia`).
- Area diportista (`docs/area-diportista.md`): pagine in `src/app/(diportista)/`, che iniziano con `requireOwner()` e
  filtrano **sempre** per `ctx.ownerId` e `ctx.marinaId`. Una sessione con `sessions.owner_access_id` è nell'area
  diportista e non apre il gestionale (`requireMarina` la rimanda a `/diportista`). Inviti, attivazione e revoca in
  `src/server/owner-access.ts`; codici, codice fiscale e messaggio in `src/lib/owner-access.ts`; attivazione pubblica
  su `/attiva`; riquadro «Accesso all'app» nella scheda cliente. L'area si apre solo con l'email confermata
  (`isEmailVerified`); anonimizzare un cliente cancella inviti e accessi.
  Dati del diportista in `src/server/owner-area.ts` (contratti attivi e conclusi, barche, addebiti, scadenze); il contratto
  stampato è un componente unico (`src/components/contract-document.tsx`) per ufficio e diportista.
- Messaggi ai diportisti (`/messaggi`, `src/server/messages.ts`): destinatari fissati all'invio in `message_recipients`
  (un cliente = letto se una sua persona lo apre); la banchina non scrive a «tutti» né per tipo di contratto (`canSendTo`).
  Notifiche web push in `src/server/push.ts` (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, service worker `public/sw.js`):
  senza chiavi sono spente. Il diportista segna letto aprendo il messaggio (`MarkRead`, mai durante il precaricamento).
- Allerte (`/meteo`, voce di menu «Allerte», tutti i ruoli; riquadro `PortWeatherCard` in cruscotto e banchina; niente per i
  diportisti, che ricevono solo i messaggi). Fonti della Protezione Civile (repository GitHub `pcm-dpc`, CC BY 4.0):
  bollettino di **vigilanza** (`DPC-Bollettini-Vigilanza-Meteorologica`, `files/AAAAMMGG.json`: simboli di vento e mare con
  coordinate, codici in `PHENOMENA`, presi entro `NEARBY_KM` dalla posizione del porto, e testi «Venti»/«Mari») e di
  **criticità** (`DPC-Bollettini-Criticita-Idrogeologica-Idraulica`, ultimo file via API dei commit, `GITHUB_TOKEN` facoltativo;
  zona dal Comune o `marinas.alert_zone`). Funzioni pure in `src/lib/civil-protection.ts`, lettura in
  `src/server/civil-protection.ts` (memoria di un'ora). `portConditions` (`src/server/port-conditions.ts`) unisce tutto e
  prepara l'avviso (burrasca, tempesta, mare agitato vicino al porto, allerta arancione/rossa): a «tutti» per direzione e
  ufficio, a «chi è in porto» per la banchina; invio automatico da `/api/meteo/controllo` (Cloud Scheduler,
  `METEO_CHECK_TOKEN`, non si ripete entro 24 ore, `wind_alert_sent_at`).
  Previsioni Open-Meteo (`src/lib/weather.ts`, `src/server/weather.ts`: vento, onda, mare lungo, corrente, livello) **spente**:
  l'uso gratuito è solo non commerciale, si accendono con `OPEN_METEO_API_KEY` (abbonamento, indirizzi `customer-…`).
  Collaudi locali: `DPC_FIXTURE`, `DPC_VIGILANCE_FIXTURE`, `WEATHER_FIXTURE` (da qui GitHub API e Open-Meteo non sono
  raggiungibili); estratti veri dei bollettini in `tests/fixtures/`.
- Produzione: `output: "standalone"` + `Dockerfile` (Cloud Run). Le migrazioni si applicano all'avvio con
  `AUTO_MIGRATE=true`; ogni modifica allo schema richiede `pnpm db:generate` e la migrazione va committata.
- Pubblicazione: `main` NON va online da solo. L'utente pubblica dal PC Windows (PowerShell), dalla cartella
  `C:\Users\roset\OneDrive\Desktop\App Porto\omnia-marina`, con
  `gcloud run deploy omnia-marina --source . --region europe-west1 --project omnia-marina` dopo un `git pull`;
  i comandi per l'utente stanno in `COME-LAVORIAMO.md`. Quando una modifica va online, ricordaglielo, e dagli **sempre prima
  il comando per scaricare i file (`git pull`) e poi quello per pubblicare** (o il comando unico di `COME-LAVORIAMO.md`, che
  pubblica solo se il `git pull` riesce): altrimenti pubblica i file vecchi.
- Prima di consegnare: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

