import { z } from "zod";
import { isValidISODate } from "./dates";
import { isUuid } from "./params";
import { parseMeters, parseMoney } from "./format";

// Stato restituito da ogni azione di modulo.
export type FormState = { ok?: boolean; message?: string; errors?: Record<string, string> } | undefined;

const REQUIRED = "Campo obbligatorio";

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export const f = {
  text: (message = REQUIRED) => z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(1, message).max(500)),
  optText: () => z.preprocess(blankToNull, z.string().max(5000).nullable()),
  id: (message = "Selezione obbligatoria") => z.preprocess((v) => (typeof v === "string" ? v : ""), z.uuid(message)),
  optId: () => z.preprocess(blankToNull, z.uuid("Selezione non valida").nullable()),
  email: () =>
    z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""), z.email("Indirizzo email non valido")),
  optEmail: () =>
    z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim().toLowerCase() : null), z.email("Indirizzo email non valido").nullable()),
  date: (message = "Data obbligatoria") =>
    z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().refine(isValidISODate, message)),
  optDate: () => z.preprocess(blankToNull, z.string().refine(isValidISODate, "Data non valida").nullable()),
  // Importo in euro scritto dall'utente, convertito in centesimi.
  money: (message = "Importo non valido") =>
    z.preprocess((v) => (typeof v === "string" ? parseMoney(v) : null), z.number({ error: message }).int().min(0, message).max(100_000_000, message)),
  optMoney: (message = "Importo non valido") =>
    z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? (parseMoney(v) ?? Number.NaN) : null),
      z.number({ error: message }).int().min(0, message).max(100_000_000, message).nullable(),
    ),
  // Misura in metri scritta dall'utente, convertita in centimetri.
  meters: (message = "Misura non valida (es. 9,50)") =>
    z.preprocess((v) => (typeof v === "string" ? parseMeters(v) : null), z.number({ error: message }).int().min(1, message).max(20_000, message)),
  optMeters: () =>
    z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? (parseMeters(v) ?? Number.NaN) : null),
      z.number({ error: "Misura non valida (es. 1,80)" }).int().min(0).max(20_000).nullable(),
    ),
  int: (min: number, max: number, message = "Numero non valido") =>
    z.preprocess((v) => (typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : Number.NaN), z.number({ error: message }).int().min(min, message).max(max, message)),
  optInt: (min: number, max: number, message = "Numero non valido") =>
    z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? (/^-?\d+$/.test(v.trim()) ? Number(v) : Number.NaN) : null),
      z.number({ error: message }).int().min(min, message).max(max, message).nullable(),
    ),
  checkbox: () => z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  choice: <const T extends readonly [string, ...string[]]>(values: T, message = "Selezione obbligatoria") =>
    z.preprocess((v) => (typeof v === "string" ? v : ""), z.enum(values, message)),
};

type Parsed<S extends z.ZodType> = { ok: true; data: z.infer<S> } | { ok: false; state: NonNullable<FormState> };

// Valida i campi di un modulo e, in caso di errori, prepara lo stato da restituire al browser.
export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): Parsed<S> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) if (typeof value === "string") raw[key] = value;
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!(key in errors)) errors[key] = issue.message;
  }
  return { ok: false, state: { message: "Controlla i campi evidenziati.", errors } };
}

export function fail(message: string, errors?: Record<string, string>): NonNullable<FormState> {
  return { message, errors };
}

/**
 * Identificativo (UUID) di un campo nascosto del modulo; vuoto se manca o non è valido. Va controllato prima di usarlo
 * nel database: un valore manomesso farebbe altrimenti fallire la query con un errore del server.
 */
export function formId(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" && isUuid(value) ? value : "";
}
