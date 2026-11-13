export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Primo valore di un parametro dell'indirizzo, come stringa (vuota se assente).
export function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Gli identificativi arrivano dall'indirizzo: se non sono UUID validi si trattano come assenti.
export function uuidOrNull(value: string | string[] | undefined): string | null {
  const v = one(value);
  return UUID.test(v) ? v : null;
}

export function qs(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const s = search.toString();
  return s ? `?${s}` : "";
}
