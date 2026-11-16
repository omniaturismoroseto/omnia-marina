// La chiamata a Claude su Vertex AI provata contro un finto server Google locale:
// controlla indirizzo, contenuto della richiesta e lettura della risposta, senza costi né credenziali.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Anthropic, { betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { analyzePlanPhoto, PlanAnalysisError } from "../src/server/plan-ai";

const analysis = {
  structures: [
    {
      name: "Pontile centrale",
      kind: "pontile",
      start: { x: 400, y: 800 },
      end: { x: 530, y: 650 },
      length_m: 110,
      sides: [{ boats_point: { x: 450, y: 700 }, berths: 25, boat_length_m: 8 }],
    },
  ],
  notes: "",
};

type Reply = { status: number; body: unknown };
let reply: Reply;
const requests: { url: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> }[] = [];
let server: Server;
let baseURL: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(raw || "{}") });
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const message = (stopReason: string, text: string) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text }],
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 300 },
});

const client = () =>
  new AnthropicVertex({
    baseURL,
    region: "global",
    projectId: "omnia-marina",
    // Al posto dell'account Google: un'autenticazione finta che restituisce un token di prova.
    authClient: { projectId: null, getRequestHeaders: async () => new Headers({ authorization: "Bearer token-di-prova" }) } as unknown as NonNullable<ConstructorParameters<typeof AnthropicVertex>[0]>["authClient"],
    maxRetries: 0,
    middleware: [betaRefusalFallbackMiddleware([{ model: "claude-opus-4-8" }], { onError: () => {} })],
  });

const photo = { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mime: "image/jpeg", width: 2000, height: 1143 };

describe("analisi della foto con Claude su Vertex AI", () => {
  it("manda foto e istruzioni al modello giusto e legge la risposta strutturata", async () => {
    requests.length = 0;
    reply = { status: 200, body: message("end_turn", JSON.stringify(analysis)) };
    const result = await analyzePlanPhoto(photo, 2.99, client());
    expect(result.structures[0].name).toBe("Pontile centrale");

    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.url).toBe("/v1/projects/omnia-marina/locations/global/publishers/anthropic/models/claude-opus-5-5:rawPredict");
    expect(req.headers.authorization).toBe("Bearer token-di-prova");
    expect(req.body.anthropic_version).toBe("2026-10-21"); // su Vertex la versione dell'API viaggia nel corpo
    expect(req.body.model).toBeUndefined(); // su Vertex il modello sta nell'indirizzo
    const content = (req.body.messages as { content: { type: string; source?: { media_type: string } }[] }[])[0].content;
    expect(content[0].type).toBe("image");
    expect(content[0].source?.media_type).toBe("image/jpeg");
    expect(content[1].type).toBe("text");
    const output = req.body.output_config as { effort: string; format: { type: string; schema: object } };
    expect(output.effort).toBe("high");
    expect(output.format.type).toBe("json_schema");
    expect(JSON.stringify(output.format.schema)).toContain("boats_point");
    expect(req.body.thinking).toEqual({ type: "adaptive" });
  });

  it("un rifiuto del modello diventa un messaggio comprensibile", async () => {
    reply = { status: 200, body: { ...message("refusal", ""), content: [] } };
    await expect(analyzePlanPhoto(photo, null, client())).rejects.toThrow(/rifiutato questa immagine/);
  });

  it("un permesso mancante su Google rimanda alle istruzioni", async () => {
    reply = { status: 403, body: { error: { type: "permission_error", message: "Permission denied" } } };
    await expect(analyzePlanPhoto(photo, null, client())).rejects.toThrow(PlanAnalysisError);
    await expect(analyzePlanPhoto(photo, null, client())).rejects.toThrow(/abilitato in Vertex AI/);
  });

  it("una quota esaurita su Google viene spiegata, con il motivo dato da Google", async () => {
    reply = {
      status: 429,
      body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for aiplatform.googleapis.com/online_prediction_requests_per_base_model with base model: anthropic-claude-opus-5-5." } },
    };
    const call = analyzePlanPhoto(photo, null, client());
    await expect(call).rejects.toThrow(PlanAnalysisError);
    await expect(call).rejects.toThrow(/quota del progetto.*Dettaglio di Google: .*Quota exceeded/);
  });

  it("una capacità momentaneamente piena chiede di riprovare", async () => {
    reply = { status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Resource exhausted. Please try again later." } } };
    await expect(analyzePlanPhoto(photo, null, client())).rejects.toThrow(/momentaneamente occupato.*Resource exhausted/);
  });

  it("una risposta che non rispetta lo schema non viene usata", async () => {
    reply = { status: 200, body: message("end_turn", JSON.stringify({ structures: [{ name: "x" }], notes: "" })) };
    await expect(analyzePlanPhoto(photo, null, client())).rejects.toThrow(/non è leggibile/);
  });

  it("una risposta troncata non viene usata", async () => {
    reply = { status: 200, body: message("max_tokens", '{"structures": [') };
    await expect(analyzePlanPhoto(photo, null, client())).rejects.toThrow(/incompleta/);
  });
});

// Con la chiave Anthropic: stessa richiesta verso l'API diretta, con il ripiego su un altro modello affidato al server.
const direct = () => new Anthropic({ apiKey: "chiave-di-prova", baseURL: baseURL.replace(/\/v1$/, ""), maxRetries: 0 });

describe("analisi della foto con l'API Anthropic diretta", () => {
  it("usa la chiave, il modello nel corpo e il ripiego lato server", async () => {
    requests.length = 0;
    reply = { status: 200, body: message("end_turn", JSON.stringify(analysis)) };
    const result = await analyzePlanPhoto(photo, 2.99, direct());
    expect(result.structures[0].sides[0].berths).toBe(25);

    const [req] = requests;
    expect(req.url).toBe("/v1/messages");
    expect(req.headers.authorization).toBe("Bearer chiave-di-prova"); // questa versione della libreria manda la chiave così
    expect(String(req.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(req.body.model).toBe("claude-opus-5-5");
    expect(req.body.fallbacks).toBe("default");
    expect(req.body.thinking).toEqual({ type: "adaptive" });
  });

  it("una chiave non valida viene spiegata", async () => {
    reply = { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } };
    await expect(analyzePlanPhoto(photo, null, direct())).rejects.toThrow(/chiave Anthropic non è valida/);
  });

  it("un credito esaurito viene spiegato", async () => {
    reply = { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } } };
    await expect(analyzePlanPhoto(photo, null, direct())).rejects.toThrow(/credito dell'account Anthropic è esaurito/);
  });

  it("troppe richieste ravvicinate chiedono di riprovare", async () => {
    reply = { status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "Number of requests has exceeded your rate limit" } } };
    await expect(analyzePlanPhoto(photo, null, direct())).rejects.toThrow(/riprova tra qualche minuto/);
  });
});
