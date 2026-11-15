import "server-only";
import { readFile } from "node:fs/promises";
import Anthropic, { BetaFallbackState, betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { z } from "zod";
import type { AiAnalysis } from "@/lib/plan-analysis";

/*
 * Riconoscimento automatico di pontili e banchine nella foto aerea, con Claude su Google Cloud (Vertex AI).
 * Gira nel progetto Google del porto: nessuna chiave a parte, l'app si autentica con il proprio account di servizio
 * e il costo finisce sulla fatturazione Google. Attivazione: variabile ANTHROPIC_VERTEX_PROJECT_ID (vedi COME-LAVORIAMO.md).
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

export class PlanAnalysisError extends Error {}

// Il motivo dato da Google, in breve: la pagina è riservata alla direzione, e così l'errore si capisce senza aprire i registri.
function googleDetail(error: InstanceType<typeof Anthropic.APIError>): string {
  const text = error.message.replace(/\s+/g, " ").trim();
  return text ? ` Dettaglio di Google: ${text.slice(0, 220)}${text.length > 220 ? "…" : ""}` : "";
}

export function planAnalysisAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_VERTEX_PROJECT_ID || process.env.PLAN_ANALYSIS_FIXTURE);
}

function defaultClient(): AnthropicVertex {
  return new AnthropicVertex({
    projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
    region: process.env.CLOUD_ML_REGION || "global",
    // Un'analisi con la foto può richiedere un paio di minuti; meglio un solo nuovo tentativo che lunghe attese.
    timeout: 4 * 60 * 1000,
    maxRetries: 1,
    middleware: [betaRefusalFallbackMiddleware([{ model: FALLBACK_MODEL }])],
  });
}

/**
 * Chiede a Claude di riconoscere pontili e banchine nella foto.
 * `client` si può sostituire nei test; in produzione è il client Vertex AI del progetto.
 */
export async function analyzePlanPhoto(
  photo: { data: Buffer; mime: string; width: number; height: number },
  pxPerMeter: number | null,
  client: Anthropic | AnthropicVertex | null = null,
): Promise<AiAnalysis> {
  // Solo per i collaudi: una risposta preparata, senza chiamare Google.
  const fixture = process.env.PLAN_ANALYSIS_FIXTURE;
  if (fixture && !client) return AnalysisSchema.parse(JSON.parse(await readFile(fixture, "utf8")));

  const api = client ?? defaultClient();
  let message;
  try {
    // create (non parse): così si legge il motivo di fine risposta prima di interpretarla.
    message = await api.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: betaZodOutputFormat(AnalysisSchema) },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: photo.mime === "image/png" ? "image/png" : "image/jpeg", data: photo.data.toString("base64") },
              },
              { type: "text", text: buildPrompt(photo.width, photo.height, pxPerMeter) },
            ],
          },
        ],
      },
      { fallbackState: new BetaFallbackState() },
    );
  } catch (error) {
    console.error("Analisi della foto non riuscita:", error);
    if (error instanceof Anthropic.RateLimitError) {
      // Google risponde 429 sia per una quota del progetto esaurita (o mai assegnata) sia per capacità momentaneamente piena.
      if (/quota/i.test(error.message)) {
        throw new PlanAnalysisError(
          `Google dice che la quota del progetto per Claude è esaurita o non ancora assegnata: va chiesto un aumento in Google Cloud → IAM e amministrazione → Quote (istruzioni in COME-LAVORIAMO.md).${googleDetail(error)}`,
        );
      }
      throw new PlanAnalysisError(`Il servizio di analisi è momentaneamente occupato: riprova tra qualche minuto.${googleDetail(error)}`);
    }
    if (error instanceof Anthropic.APIError && (error.status === 401 || error.status === 403 || error.status === 404)) {
      throw new PlanAnalysisError(
        `Google ha rifiutato la richiesta: controlla che Claude sia abilitato in Vertex AI e che l'app abbia il permesso di usarlo (istruzioni in COME-LAVORIAMO.md).${googleDetail(error)}`,
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
  const result = AnalysisSchema.safeParse(parsed);
  if (!result.success) {
    console.error("Risposta dell'analisi non conforme allo schema:", result.error.issues.slice(0, 5));
    throw new PlanAnalysisError("La risposta dell'analisi non è leggibile. Riprova.");
  }
  return result.data;
}
