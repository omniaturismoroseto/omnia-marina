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
- Marchio: originali (a colori e in negativo per sfondi scuri) in `marchio/`; per l'interfaccia `src/components/brand.tsx` con le
  immagini di `src/assets/brand/` (già alla misura giusta, `unoptimized`); icone in `src/app` (favicon, icon, apple-icon) e `public/`.
- Pianta dal vero: le coordinate dei posti (`berths.plan_x/plan_y/plan_angle`) sono in pixel della foto caricata;
  la geometria sta in `src/lib/plan.ts`, la foto nel database (`marina_plans`) ed è servita da `/pianta/immagine`.
- Contratto stampato (`/contratti/[id]/stampa`): gli articoli 1-3 (oggetto, canone, spese) li compone la pagina con i dati
  del contratto; dal 4 in poi stampa `marinas.contract_terms`, poi l'approvazione specifica `marinas.contract_approval_text`
  (modelli in `src/lib/contract-texts.ts`). Spazi a terra, posti auto, carrello e spese fisse sono `contract_items`, ognuna con
  il proprio addebito (`src/server/contracts.ts`).
- Riconoscimento automatico: `src/server/plan-ai.ts` chiama Claude (`claude-opus-5-5`) su Vertex AI con `AnthropicVertex`;
  si accende con `ANTHROPIC_VERTEX_PROJECT_ID` (+ `CLOUD_ML_REGION`, predefinito `global`). La conversione della risposta
  in proposte è in `src/lib/plan-analysis.ts`. Per i collaudi locali `PLAN_ANALYSIS_FIXTURE` (percorso di un JSON) sostituisce
  la chiamata: non metterlo nel `.env` dell'anteprima, e ricompilare dopo averlo tolto (la build copia `.env` in `.next/standalone`).
- Produzione: `output: "standalone"` + `Dockerfile` (Cloud Run). Le migrazioni si applicano all'avvio con
  `AUTO_MIGRATE=true`; ogni modifica allo schema richiede `pnpm db:generate` e la migrazione va committata.
- Pubblicazione: `main` NON va online da solo. L'utente pubblica dal PC Windows (PowerShell), dalla cartella
  `C:\Users\roset\OneDrive\Desktop\App Porto\omnia-marina`, con
  `gcloud run deploy omnia-marina --source . --region europe-west1 --project omnia-marina` dopo un `git pull`;
  i comandi per l'utente stanno in `COME-LAVORIAMO.md`. Quando una modifica va online, ricordaglielo.
- Prima di consegnare: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

