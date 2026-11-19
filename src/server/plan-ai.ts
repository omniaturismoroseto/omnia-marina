import "server-only";
import { readFile } from "node:fs/promises";
import Anthropic, { BetaFallbackState, betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { z } from "zod";
import type { AiAnalysis } from "@/lib/plan-analysis";
import type { AiDrawing } from "@/lib/plan-drawing";

/*
 * Riconoscimento automatico di pontili e banchine nella foto aerea, con Claude. Due strade (vedi COME-LAVORIAMO.md):
 * - API Anthropic diretta: variabile ANTHROPIC_API_KEY (in produzione dall'archivio segreti di Google). Ha la precedenza.
 * - Claude su Google Cloud (Vertex AI): variabile ANTHROPIC_VERTEX_PROJECT_ID; l'app si autentica con il proprio
 *   account di servizio e il costo va sulla fatturazione Google, ma serve una quota assegnata da Google.
 */

const MODEL = "claude-opus-5-5";
// Usato solo se il modello principale declina la richiesta (eventualità molto rara per una foto di un porto).
const FALLBACK_MODEL = "claude-opus-4-8";

// Nessun vincolo numerico nello schema: l'API non li supporta; i valori si correggono dopo, in toProposals.
const point = z.object({
  x: z.number().describe("Millesimi della larghezza: 0 = bordo sinistro, 1000 = bordo destro"),
  y: z.number().describe("Millesimi dell'altezza: 0 = bordo in alto, 1000 = bordo in basso"),
});

const AnalysisSchema = z.object({
  structures: z.array(
    z.object({
      name: z.string().describe("Nome breve in italiano che descrive la posizione, es. «Pontile centrale», «Banchina nord»"),
      kind: z.enum(["pontile", "banchina"]),
      start: point.describe("Pontile: la radice, dove si attacca a terra. Banchina: un'estremità del tratto con le barche."),
      end: point.describe("Pontile: la testata, verso l'acqua. Banchina: l'altra estremità."),
      length_m: z.number().describe("Lunghezza stimata del tratto da start a end, in metri"),
      sides: z.array(
        z.object({
          boats_point: point.describe("Un punto al centro della fila di barche di questo lato"),
          berths: z.number().int().describe("Numero di posti barca su questo lato: barche ormeggiate più spazi liberi evidenti tra loro"),
          boat_length_m: z.number().describe("Lunghezza tipica delle barche di questo lato, in metri"),
        }),
      ),
    }),
  ),
  notes: z.string().describe("Al massimo due frasi in italiano su dubbi o parti della foto poco leggibili; vuoto se nessuno"),
});

function buildPrompt(width: number, height: number, pxPerMeter: number | null): string {
  const scale = pxPerMeter
    ? `In questa foto 1 metro corrisponde a circa ${pxPerMeter.toFixed(2)} pixel (la foto originale è ${width} × ${height} pixel).`
    : `La foto originale è ${width} × ${height} pixel; la scala non è nota: stimala dalle dimensioni delle barche e delle auto.`;
  return `Questa è una foto aerea, ripresa dall'alto, di un porto turistico. Serve a disegnare la pianta dei posti barca.

Individua tutte le strutture con posti barca:
- pontili: strutture che entrano nell'acqua, con barche ormeggiate su uno o su entrambi i lati;
- banchine: tratti di molo o di riva con barche ormeggiate su un lato.

Per ciascuna struttura:
- traccia l'asse come un segmento rettilineo da start a end. Per una banchina traccia il bordo verso l'acqua, dove toccano le poppe o le prue. Se un pontile o una banchina piega (a L, a T o in curva), dividilo in tratti rettilinei separati, ognuno con le sue barche;
- per ogni lato con barche ormeggiate di punta (perpendicolari alla struttura) indica un punto al centro della fila di barche, quanti posti ci sono e la lunghezza tipica delle barche. Conta anche i posti liberi evidenti tra una barca e l'altra;
- dai un nome breve in italiano che ne descriva la posizione nel porto.

Ignora le barche a terra (rimessaggio, cantiere, carrelli), quelle alla fonda in mezzo al bacino e le strutture senza barche.

Le coordinate sono millesimi della foto: x da 0 (bordo sinistro) a 1000 (bordo destro), y da 0 (bordo in alto) a 1000 (bordo in basso). Sii preciso: le linee verranno sovrapposte alla foto.

${scale}`;
}

const DrawingSchema = z.object({
  land: z.array(
    z.object({
      kind: z.enum(["terra", "molo", "diga"]).describe("terra: costa, piazzali, edifici, strade; molo: moli e banchine in muratura che entrano nell'acqua; diga: dighe foranee e scogliere"),
      points: z.array(point).describe("Vertici del contorno, in ordine lungo il bordo; il poligono si chiude da solo tra l'ultimo e il primo"),
    }),
  ),
  notes: z.string().describe("Al massimo una frase in italiano su parti poco leggibili; vuoto se nessuna"),
});

function buildDrawingPrompt(width: number, height: number): string {
  return `Questa è una foto aerea, ripresa dall'alto, di un porto turistico (${width} × ${height} pixel). Serve a disegnarne una pianta pulita, come una planimetria: acqua, terra, moli e dighe.

Traccia il contorno di tutte le parti fisse che non sono acqua:
- terra: la costa con piazzali, strade, parcheggi, edifici, spiagge e verde, come un'unica area (o poche aree grandi);
- molo: i moli e le banchine in muratura o cemento che entrano nell'acqua, ognuno con il suo contorno;
- diga: le dighe foranee, le scogliere e i frangiflutti.

Non tracciare i pontili galleggianti (passerelle strette con le barche ai lati), le barche, le boe né le ombre: verranno disegnati a parte.

Ogni contorno è un poligono con i vertici in ordine lungo il bordo. Segui con cura il bordo dell'acqua, dove ormeggiano le barche: usa abbastanza punti per seguirne la forma (da 4 a 80 per poligono), di più dove la riva è irregolare. Dove la terra arriva al bordo della foto, chiudi il contorno lungo il bordo.

Le coordinate sono millesimi della foto: x da 0 (bordo sinistro) a 1000 (bordo destro), y da 0 (bordo in alto) a 1000 (bordo in basso). Sii preciso: la pianta disegnata verrà sovrapposta ai posti barca già disposti sulla foto.`;
}

export class PlanAnalysisError extends Error {}

// Il motivo dato dal servizio, in breve: la pagina è riservata alla direzione, e così l'errore si capisce senza aprire i registri.
function serviceDetail(error: InstanceType<typeof Anthropic.APIError>, provider: Provider): string {
  const text = error.message.replace(/\s+/g, " ").trim();
  return text ? ` Dettaglio di ${provider === "vertex" ? "Google" : "Anthropic"}: ${text.slice(0, 220)}${text.length > 220 ? "…" : ""}` : "";
}

// Errori dell'API Anthropic diretta: chiave, credito, limiti di frequenza.
function anthropicError(error: unknown): PlanAnalysisError | null {
  if (!(error instanceof Anthropic.APIError)) return null;
  const detail = serviceDetail(error, "anthropic");
  if (error instanceof Anthropic.AuthenticationError) {
    return new PlanAnalysisError(`La chiave Anthropic non è valida o è stata revocata: creane una nuova e aggiornala (istruzioni in COME-LAVORIAMO.md).${detail}`);
  }
  if (error.status === 400 && /credit balance/i.test(error.message)) {
    return new PlanAnalysisError(`Il credito dell'account Anthropic è esaurito: ricaricalo su console.anthropic.com → Billing, poi riprova.${detail}`);
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new PlanAnalysisError(`Anthropic ha rifiutato la richiesta: controlla che la chiave abbia accesso al modello (istruzioni in COME-LAVORIAMO.md).${detail}`);
  }
  if (error instanceof Anthropic.RateLimitError || error.status === 529) {
    return new PlanAnalysisError(`Il servizio di analisi è momentaneamente occupato o hai fatto troppe richieste ravvicinate: riprova tra qualche minuto.${detail}`);
  }
  return null;
}

type Provider = "anthropic" | "vertex";

function configuredProvider(): Provider | null {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.ANTHROPIC_VERTEX_PROJECT_ID) return "vertex";
  return null;
}

export function planAnalysisAvailable(): boolean {
  return Boolean(configuredProvider() || process.env.PLAN_ANALYSIS_FIXTURE || process.env.PLAN_DRAWING_FIXTURE);
}

function defaultClient(): Anthropic | AnthropicVertex {
  if (configuredProvider() === "anthropic") {
    // trim: una chiave incollata con un a capo finale verrebbe rifiutata.
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), timeout: 4 * 60 * 1000, maxRetries: 1 });
  }
  return new AnthropicVertex({
    projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
    region: process.env.CLOUD_ML_REGION || "global",
    // Un'analisi con la foto può richiedere un paio di minuti; meglio un solo nuovo tentativo che lunghe attese.
    timeout: 4 * 60 * 1000,
    maxRetries: 1,
    middleware: [betaRefusalFallbackMiddleware([{ model: FALLBACK_MODEL }])],
  });
}

type Photo = { data: Buffer; mime: string; width: number; height: number };

/**
 * Chiede a Claude di riconoscere pontili e banchine nella foto.
 * `client` si può sostituire nei test; in produzione è il client Vertex AI del progetto.
 */
export async function analyzePlanPhoto(photo: Photo, pxPerMeter: number | null, client: Anthropic | AnthropicVertex | null = null): Promise<AiAnalysis> {
  // Solo per i collaudi: una risposta preparata, senza chiamare Google.
  const fixture = process.env.PLAN_ANALYSIS_FIXTURE;
  if (fixture && !client) return AnalysisSchema.parse(JSON.parse(await readFile(fixture, "utf8")));
  return askAboutPhoto(photo, buildPrompt(photo.width, photo.height, pxPerMeter), AnalysisSchema, client);
}

/** Chiede a Claude i contorni di terra, moli e dighe, per la pianta disegnata. */
export async function drawPlanPhoto(photo: Photo, client: Anthropic | AnthropicVertex | null = null): Promise<AiDrawing> {
  const fixture = process.env.PLAN_DRAWING_FIXTURE;
  if (fixture && !client) return DrawingSchema.parse(JSON.parse(await readFile(fixture, "utf8")));
  return askAboutPhoto(photo, buildDrawingPrompt(photo.width, photo.height), DrawingSchema, client);
}

async function askAboutPhoto<T>(photo: Photo, prompt: string, schema: z.ZodType<T>, client: Anthropic | AnthropicVertex | null): Promise<T> {
  const api = client ?? defaultClient();
  const provider: Provider = api instanceof AnthropicVertex ? "vertex" : "anthropic";
  let message;
  try {
    // create (non parse): così si legge il motivo di fine risposta prima di interpretarla.
    message = await api.beta.messages.create(
      {
        model: MODEL,
        // Sull'API diretta, se il modello declina la richiesta la riprova il server con un altro modello adatto;
        // su Vertex questo parametro non esiste e se ne occupa il middleware del client.
        ...(provider === "anthropic" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: betaZodOutputFormat(schema) },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: photo.mime === "image/png" ? "image/png" : "image/jpeg", data: photo.data.toString("base64") },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      },
      provider === "vertex" ? { fallbackState: new BetaFallbackState() } : undefined,
    );
  } catch (error) {
    console.error("Analisi della foto non riuscita:", error);
    if (provider === "anthropic") {
      const known = anthropicError(error);
      if (known) throw known;
    } else if (error instanceof Anthropic.RateLimitError) {
      // Google risponde 429 sia per una quota del progetto esaurita (o mai assegnata) sia per capacità momentaneamente piena.
      if (/quota/i.test(error.message)) {
        throw new PlanAnalysisError(
          `Google dice che la quota del progetto per Claude è esaurita o non ancora assegnata: va chiesto un aumento in Google Cloud → IAM e amministrazione → Quote (istruzioni in COME-LAVORIAMO.md).${serviceDetail(error, provider)}`,
        );
      }
      throw new PlanAnalysisError(`Il servizio di analisi è momentaneamente occupato: riprova tra qualche minuto.${serviceDetail(error, provider)}`);
    }
    if (provider === "vertex" && error instanceof Anthropic.APIError && (error.status === 401 || error.status === 403 || error.status === 404)) {
      throw new PlanAnalysisError(
        `Google ha rifiutato la richiesta: controlla che Claude sia abilitato in Vertex AI e che l'app abbia il permesso di usarlo (istruzioni in COME-LAVORIAMO.md).${serviceDetail(error, provider)}`,
      );
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new PlanAnalysisError("L'analisi ha impiegato troppo tempo. Riprova.");
    throw new PlanAnalysisError("L'analisi non è riuscita. Riprova tra poco; se succede ancora, guarda il registro dell'app.");
  }

  if (message.stop_reason === "refusal") throw new PlanAnalysisError("Il servizio di analisi ha rifiutato questa immagine. Disponi i pontili a mano.");
  if (message.stop_reason === "max_tokens") throw new PlanAnalysisError("La risposta dell'analisi è incompleta. Riprova con una foto inquadrata più da vicino.");

  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("Risposta dell'analisi non in formato JSON:", text.slice(0, 500));
    throw new PlanAnalysisError("La risposta dell'analisi non è leggibile. Riprova.");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    console.error("Risposta dell'analisi non conforme allo schema:", result.error.issues.slice(0, 5));
    throw new PlanAnalysisError("La risposta dell'analisi non è leggibile. Riprova.");
  }
  return result.data;
}
