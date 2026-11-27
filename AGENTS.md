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
- Tariffe: una riga di `rates` per listino × categoria × pontile (`pier_id` vuoto = tariffa base, vincolo unico NULLS NOT DISTINCT);
  ogni pontile ha la sua scheda in Tariffe, ma i pontili con lo stesso nome (`groupPiersByName`/`pierGroupKey`) ne hanno una sola e
  le azioni scrivono i prezzi e la tariffa base su tutti. `piers.base_rate` acceso = il pontile usa la tariffa base (si sceglie per più pontili
  nella scheda «Tariffa base»), spento = i suoi prezzi; `ratePierId` + `pierRate` (`src/lib/pricing.ts`) uniscono pontile e base campo per campo. `rates.waste` e `rates.service`
  (condominio) non entrano nel canone: precompilano le voci «rifiuti» e «gestione» degli annuali. `price_lists.vat_included`: prezzi del
  listino (tariffe e servizi) IVA inclusa o netti; i contratti lavorano sempre IVA compresa (`withVat`, `grossQuote`, `extrasOfList`),
  la griglia mostra «IVA» e «Totale annuo» (`annualTotal`).
- Marchio: originali (a colori e in negativo per sfondi scuri) in `marchio/`, anche in orizzontale (`omnia-marina-logo-orizzontale*.png`,
  composto dai pezzi del logo verticale); per l'interfaccia `src/components/brand.tsx` con le immagini di `src/assets/brand/` (già alla
  misura giusta, `unoptimized`): `BrandWide` in alto nel menu, `BrandLogo` nelle pagine di accesso. Icone in `src/app` (favicon, icon,
  apple-icon) e `public/`. Nome dell'app installata: «Omnia Marina Gestionale» (`src/app/manifest.ts` e metadati in `src/app/layout.tsx`).
- Aspetto: carattere Figtree (`@fontsource-variable/figtree`, testi e titoli), colori in `src/app/globals.css` (accento `sea` blu navy
  spento, menu `deep`). Icone Material Symbols arrotondate piene, generate in `src/components/icons.tsx` da `scripts/build-icons.mjs`
  (`@material-symbols/svg-400`): per una nuova icona aggiungerla alla tabella dello script con il nome usato nell'app e rigenerare.
  Si importano da `@/components/icons` (tipo `AppIcon`), mai da altre librerie.
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
- Pianta dal vero (in Impostazioni la sezione si chiama «Mappa del porto», `/impostazioni/pianta`): le coordinate dei posti (`berths.plan_x/plan_y/plan_angle`) sono in pixel della foto caricata;
  la geometria sta in `src/lib/plan.ts`, la foto nel database (`marina_plans`) ed è servita da `/pianta/immagine`.
  La mappa (`/mappa`) ha «Schema» (predefinito: disegno pulito ricavato dalla pianta, `buildDrawing` in `src/lib/plan-drawing.ts`)
  e «Foto dal vero» (`?vista=foto`), entrambe in `PlanView` con le sagome delle barche alla loro misura e la poppa verso il pontile.
  La linea di ogni pontile (`piers.plan_ax/ay/bx/by`, `plan_width_m`, 0 = banchina) si salva quando lo si traccia nell'editor o
  lo crea il riconoscimento automatico; senza linea la geometria si ricava dai posti. Senza pianta resta la griglia dei pontili.
  `PlanZoom` (`src/app/(app)/mappa/plan-zoom.tsx`): niente barre né pulsanti di zoom, si trascina e si ingrandisce con rotellina/dita.
  Ingrandimento massimo: il più grande tra 8 volte la vista intera e `MAX_SCALE` (6 pixel dello schermo per pixel della pianta), così sul telefono si arriva a vedere bene i posti.
  Sfondo e servizi dello schema in `plan_features` (terra, acqua che scava la terra, edificio, verde, servizio = un punto con il tipo
  del catalogo `src/lib/port-services.ts`, icone in `src/components/service-icon.tsx`; colori in `src/lib/plan-style.ts`). Editor in
  Impostazioni → Pianta (`surroundings-editor.tsx`): terra e acqua dai colori della foto nel browser (`src/lib/land-mask.ts`, semi in acqua
  davanti alla prua dei posti, posti barca forzati ad acqua), edifici/verde/servizi da Claude (`analyzeSurroundings`, stesso limite
  giornaliero delle analisi; collaudi con `PLAN_SURROUNDINGS_FIXTURE`), poi ritocchi a mano e `savePlanFeatures` (sostituisce tutto).
  Base disegnata (`marina_plan_bases`, `/pianta/base`, `base-uploader.tsx`): PNG/JPEG fatto fuori dall'app ricalcando la foto, stesse
  proporzioni (`baseMatchesPhoto` in `src/lib/plan-base.ts`, qualunque risoluzione); se c'è, lo schema mostra la base al posto del disegno
  automatico (terra, forme, pontili) e sopra barche, codici dei posti (scritti lungo il posto) e servizi (spostabili dalla direzione).
  Sulla mappa niente nomi dei pontili (troppe scritte): il nome compare nel riquadro del posto; i servizi hanno icona sulla mappa e legenda sotto.
  Con la pianta la pagina Mappa è a tutta larghezza (`data-wide`, il layout toglie `max-w-6xl`) e `PlanZoom fillScreen` arriva al fondo
  dello schermo; il riquadro del posto sta sopra la mappa sugli schermi grandi (`?posto=`, X per chiudere), sotto sul telefono.
  Le icone dei servizi hanno sempre lo stesso raggio sullo schermo (12 px, `MARKER_SCREEN_RADIUS`), anche sul telefono e a ogni ingrandimento (`--plan-px` impostato da `PlanZoom`).
  Editor dei posti (`plan-editor.tsx`, dentro `PlanZoom arrowKeys={false}`: trascina e zoom come la Mappa, niente barre; riquadri senza
  codici): «Sposta: pontile o tratto / modulo / posto singolo». Modulo = posti collegati per vicinanza (`moduleOf`). Con un gruppo:
  trascinamento, frecce, rotazione (attorno al centro) e «Lunghezza ±1/±5 m» (`stretch`, scala le posizioni lungo il pontile); la linea
  salvata segue solo con «pontile o tratto» e si risalva con la pianta.
  Sotto i posti l'editor parte dalla base disegnata (senza base, dallo schema `buildDrawing` calcolato dal vivo coi posti dell'editor);
  «Foto dal vero» si sceglie. Ormeggio: «di prua» o «all'inglese» (`Mooring`, `layoutPier(..., mooring)` in `src/lib/plan.ts`), scelto
  in «Disponi un pontile», «Nuovo pontile» e «Ridisegna con una linea»; non si salva, si riconosce dai posti (`isAlongside` rispetto alla
  linea, `mooringAlong`, `rowAxis` senza linea) in schema, «Allinea in fila», allungamento, posti nuovi e ridisposizione dei tratti.
  Cambiare ormeggio a posti già disposti (`changeMooring` nell'editor, dal riquadro del gruppo o da «Disponi un pontile») li ridispone
  lungo la loro linea (`estimateTrace` se manca), stesso lato, allungata con `fitTrace`.
  Numerazione girata dalla barra dei posti scelti in Pontili e posti («Numerazione»: «Parti dall'altra estremità» / «Scambia i lati»,
  posti dello stesso tratto): `flipNumbering` in `src/server/piers.ts` cambia `position`/`side` e specchia i posti sulla pianta
  (`mirrorBerths`, `src/lib/plan-mirror.ts`); con «estremi» sul tratto intero la linea salvata si inverte. Non sta nell'editor.
  «Unisci» nella barra dei posti scelti (`BulkModuleForm`, `setModules` in `src/server/piers.ts`): i posti di un tratto diventano un modulo
  nuovo o entrano in uno esistente; si fissano i moduli del tratto come li mostra la scheda e si tolgono i nomi dei moduli vuoti.
  Nomi dei moduli in `berth_modules` (pontile, tratto, numero del modulo; `renameModule` fissa anche `plan_module` dei posti).
  «Mostra sulla mappa» nella scheda del pontile apre sotto l'editor (`loadPlanEditor` in `src/server/plan-editor.ts`, condiviso con
  Mappa del porto) inquadrato sul pontile o tratto (`PlanEditor zoomTo`, `PlanZoom focus`); in giallo (`highlightIds`) i posti scelti
  nella scheda o il tratto aperto. Le azioni sui posti scelti stanno nella barra in basso (Modifica, Codici, Numerazione, Unisci, Dividi = tratto con i posti scelti,
  Elimina); nel menu del tratto (`UnitMenu`) solo quelle su tutto il tratto (disposizione, aggiungi posti, rinomina, pontile a sé, togli). Bordo dei posti nell'editor: 0,08 m.
  Viceversa i posti scelti sulla mappa (`PlanEditor onSelectionChange`) sono contornati in arancio nella scheda (`mapPickedIds`); la
  scheda passa al loro pontile, la mappa resta inquadrata (`map.zoomPierId`). Riposizionando posti l'editor usa `placePicked(..., modules)`:
  «keep» (cambio di ormeggio, allinea: i posti all'inglese, distanziati, per vicinanza sembrerebbero staccati), «one» (ridisegna con una
  linea), «recognize»; «Rimetti in un modulo solo» per i pontili già spezzati. Nell'interfaccia l'ormeggio è «di prua» / «all'inglese».
  In Pontili e posti i moduli lunghi vanno a capo a blocchi (`BerthStrip`), mai barra di scorrimento.
  Una foto con inquadratura diversa azzera posti, linee dei pontili, sfondo e base.
- Posti auto riservati (Impostazioni → Posti auto, `/impostazioni/posti-auto`): tabella `parking_spaces` (codice, coperto, misure,
  in servizio, `plan_x/plan_y/plan_angle` in pixel della foto come i posti barca); azioni in `src/server/parking-actions.ts`, editor
  sulla mappa `parking-editor.tsx` (posa, «Metti in fila» con `layoutPier`, «Allinea in fila» con `alignRows`, «Lunghezza ±1/±5 m» lungo la fila con `rowAxis`, trascina, ruota). Nei contratti la voce `auto_coperto` /
  `auto_scoperto` può avere `contract_items.parking_space_id`: `ParkingPicker` (`src/app/(app)/contratti/parking-picker.tsx`, elenco +
  «Scegli dalla mappa») nel nuovo contratto e in «Aggiungi spazio o spesa». Regole in `src/server/parking.ts`: tipo giusto, il codice
  va in `reference` (stampa), impegnato da contratti attivi o conclusi nel periodo della voce (date comprese), bozze no; controllato in
  `createContract`, `activateContract`, `addContractItem`. Sulla mappa `ParkingMarks` (`src/app/(app)/mappa/parking-marks.tsx`) in `PlanView`.
- Tema scuro del telefono: l'app è solo chiara (`colorScheme: "light dark"` + gli stessi colori nel blocco `prefers-color-scheme: dark`).
  Samsung Internet scurisce lo stesso con un suo filtro che il sito non può spegnere: `SamsungDarkNotice` (`src/components/samsung-dark-notice.tsx`,
  solo su Samsung Internet in tema scuro, una volta) spiega di spegnere «Modalità scura» del browser o attivare «Usa il tema scuro dei siti web».
- Riquadro del posto sulla mappa (`src/app/(app)/mappa/berth-panel.tsx`): ufficio e direzione vedono la scheda con foto della barca,
  proprietario con pulsante per chiamare e barra del periodo; la banchina la fascia dello stato e righe grandi. Calcoli puri in
  `src/lib/berth-panel.ts`. Foto della barca in `boat_photos` (`boats.has_photo`/`photo_version`), servita e caricata da
  `/barche/[id]/foto` (tutti i ruoli, ridotta nel browser da `BoatPhotoButton`); senza foto `BoatPicture` disegna la sagoma del tipo.
  Niente immagini cercate in rete dal modello.
- Periodi dei contratti: annuali per anno solare (`annualEnd` = 31/12 dell'anno di inizio, imposto anche dal server; vale per gli
  spazi «Annuale»), stagionali dal 1/5 al 30/9 (`SEASON_START`/`SEASON_END`, `yearPeriod` in `src/lib/dates.ts`). «Scegli dalla mappa»
  nel modulo contratto: `BerthMapPicker` con i dati di `loadPlanMap` (`src/server/plan-map.ts`) e `PlanView` con `onSelect`.
- Numerazione dei contratti: le bozze non hanno numero (`seq`/`number` vuoti, in stampa «BOZZA»); il numero nasce all'attivazione
  ed è il più basso libero dell'anno (`src/lib/contract-numbers.ts`, `assignContractNumber`). «Torna in bozza» (`revertToDraft`) libera
  numero e addebiti mai incassati; i buchi (`contractNumberGaps`) si segnalano in elenco contratti e cruscotto finché non vengono ripresi.
  Solo le bozze si modificano (`/contratti/[id]/modifica`, `updateDraftContract`). Mostrare i numeri con `contractNumberLabel`.
- Contratto stampato (`/contratti/[id]/stampa`): gli articoli 1-3 (oggetto, canone, spese) li compone la pagina con i dati
  del contratto, ma le parti fisse (titolo, apertura, Locatore, «cede in locazione», testi degli articoli 1-3, firme) sono
  `marinas.contract_texts` per chiave di `CONTRACT_PARTS` (`src/lib/contract-texts.ts`, campi tra graffe, si salvano solo quelle diverse dal
  predefinito) e `marinas.contract_summary` accende il riquadro «In sintesi»; si scrivono in Impostazioni → Porto → «Testo del contratto»; dal 4 in poi stampa `marinas.contract_terms`, poi l'approvazione specifica `marinas.contract_approval_text`
  (modelli in `src/lib/contract-texts.ts`). Spazi a terra, posti auto, carrello e spese fisse sono `contract_items`, ognuna con
  il proprio addebito (`src/server/contracts.ts`). Le voci `servizio` (cauzioni e altri servizi presi dal listino con
  `src/server/list-extras.ts`) hanno descrizione e aliquota propria (`vat_rate` 0 = senza IVA) e possono essere più d'una.
- Riconoscimento automatico: `src/server/plan-ai.ts` chiama Claude (`claude-opus-5-5`). Con `ANTHROPIC_API_KEY` (in produzione dal
  segreto `anthropic-api-key` di Secret Manager) usa l'API Anthropic diretta, con `fallbacks: "default"` lato server; altrimenti, con
  `ANTHROPIC_VERTEX_PROJECT_ID` (+ `CLOUD_ML_REGION`, predefinito `global`), Vertex AI con `AnthropicVertex` (Google ha negato la quota). La conversione della risposta
  in proposte è in `src/lib/plan-analysis.ts`. Per i collaudi locali `PLAN_ANALYSIS_FIXTURE` (percorso di un JSON) sostituisce
  la chiamata: non metterlo nel `.env` dell'anteprima, e ricompilare dopo averlo tolto (la build copia `.env` in `.next/standalone`).
- Account manager (`src/lib/account-manager.ts`): email in `ACCOUNT_MANAGER_EMAILS` (variabile di Cloud Run, mai nel codice).
  `loadContext` gli dà tutti i porti come direzione (`ctx.accountManager`, `memberships` = tutti i porti, scelta sempre da
  `/porti`); solo lui crea i porti con il loro direttore (`createMarina`); `/registrazione` vale solo alla prima installazione
  (`firstInstall`). Nei porti non compare: ogni join con `users` per mostrare un nome usa `visibleUser()` (il registro
  `withoutAccountManager()`), e Utenti, `loadMembership` e `otherAdmins` lo escludono. `createAccount` rifiuta le sue email.
  Prove: da `/porti` entra come Direzione/Ufficio/Banchina (`sessions.preview_role`, `requireMarina` usa quel ruolo) o come
  diportista di un cliente (`/porti/diportista`, `sessions.preview_owner_id`; `requireOwner` dà `preview: true` e
  `accessId` vuoto: niente messaggi segnati come letti né notifiche). Per gli altri utenti questi campi non contano.
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
  Primo accesso: `requireOwner()` rimanda a `/diportista/benvenuto` finché `owner_access.privacy_version` non è
  `appPrivacyVersion(marinas.privacy_policy_version)` (`src/lib/app-privacy.ts`: informativa del porto + parte sull'app); solo la pagina
  di benvenuto e il layout passano `allowPrivacyPending`. `acceptAppPrivacy` segna l'accesso e scrive in `privacy_consents`
  (informativa, digitale). Secondo passo: notifiche (`PushToggle`), facoltative. Marchio Omnia Marina in basso al centro.
  Il diportista vede la foto delle sue barche (`/barche/[id]/foto` filtra per `ownerId`), non la carica.
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
  i comandi per l'utente stanno in `COME-LAVORIAMO.md`. Quando una modifica va online, ricordaglielo e dagli **sempre e solo
  il comando unico** di «Pubblicare» in `COME-LAVORIAMO.md` (prima `git pull`, poi pubblica solo se il pull riesce), in un
  unico blocco da copiare: mai `git pull` e pubblicazione come comandi separati. Se l'utente è in Google Cloud Shell (bash,
`~/omnia-marina`) dagli la versione bash dello stesso comando unico, anch'essa in `COME-LAVORIAMO.md`.
- Consegna: aprire sempre la pull request, dare il comando unico per PowerShell e chiedere l'unione con un **pulsante in chat**
  (domanda a scelta: «Unisci» / «Non ancora»), non con una domanda da scrivere; con «Unisci» unire la pull request (prima
  allineando il ramo a `main` se è cambiato).
- Prima di consegnare: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

