// Regole pure per unire due pontili e per riordinarli: le usa src/server/piers.ts.

export interface Point {
  x: number;
  y: number;
}

/** Linea del pontile sulla foto, dalla radice (a) alla testata (b), e larghezza della passerella. */
export interface PierTrace {
  a: Point;
  b: Point;
  widthM: number;
}

// Due tratti sono «in linea» se differiscono di meno di 12° e stanno sulla stessa retta (scarto entro il 10% della lunghezza).
const MAX_ANGLE_COS = Math.cos((12 * Math.PI) / 180);
const MAX_OFFSET = 0.1;

/**
 * Linea del pontile unito. Senza una delle due linee resta l'altra; se i tratti sono in linea la linea si allunga fino a
 * coprirli entrambi (radice dalla parte del pontile che resta), altrimenti resta quella del pontile che resta e `aligned` è falso:
 * nello schema il pontile unito diventa una striscia sola, quindi due tratti ad angolo è meglio tenerli separati.
 */
export function mergeTraces(target: PierTrace | null, source: PierTrace | null): { trace: PierTrace | null; aligned: boolean } {
  if (!target) return { trace: source, aligned: true };
  if (!source) return { trace: target, aligned: true };
  const len = Math.hypot(target.b.x - target.a.x, target.b.y - target.a.y);
  const sourceLen = Math.hypot(source.b.x - source.a.x, source.b.y - source.a.y);
  if (len < 1) return { trace: source, aligned: true };
  if (sourceLen < 1) return { trace: target, aligned: true };

  const d = { x: (target.b.x - target.a.x) / len, y: (target.b.y - target.a.y) / len };
  const n = { x: -d.y, y: d.x };
  const sd = { x: (source.b.x - source.a.x) / sourceLen, y: (source.b.y - source.a.y) / sourceLen };
  const along = (p: Point) => (p.x - target.a.x) * d.x + (p.y - target.a.y) * d.y;
  const across = (p: Point) => (p.x - target.a.x) * n.x + (p.y - target.a.y) * n.y;

  const ts = [0, len, along(source.a), along(source.b)];
  const total = Math.max(...ts) - Math.min(...ts);
  const parallel = Math.abs(d.x * sd.x + d.y * sd.y) >= MAX_ANGLE_COS;
  const onLine = Math.max(Math.abs(across(source.a)), Math.abs(across(source.b))) <= MAX_OFFSET * total;
  if (!parallel || !onLine) return { trace: target, aligned: false };

  // La radice resta dalla parte di quella del pontile che resta (a), la testata va all'estremo opposto.
  const from = Math.min(...ts);
  const to = Math.max(...ts);
  const at = (t: number): Point => ({ x: target.a.x + d.x * t, y: target.a.y + d.y * t });
  return { trace: { a: at(from), b: at(to), widthM: target.widthM }, aligned: true };
}

export interface SlotBerth {
  id: string;
  side: "sx" | "dx";
  position: number;
}

/**
 * Posizioni dei posti che arrivano su un altro pontile: su ogni lato proseguono dopo l'ultimo posto già presente,
 * nello stesso ordine che avevano. Restituisce le nuove posizioni per id.
 */
export function appendPositions(existing: Omit<SlotBerth, "id">[], incoming: SlotBerth[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const side of ["sx", "dx"] as const) {
    const here = existing.filter((b) => b.side === side).map((b) => b.position);
    const next = here.length ? Math.max(...here) + 1 : 0;
    const list = incoming.filter((b) => b.side === side).sort((p, q) => p.position - q.position);
    list.forEach((b, i) => result.set(b.id, next + i));
  }
  return result;
}

/** Nuovo ordine dei pontili dopo aver spostato `id` di un posto in su o in giù; null se è già in cima o in fondo. */
export function movedOrder(ids: string[], id: string, direction: "su" | "giu"): string[] | null {
  const i = ids.indexOf(id);
  const j = direction === "su" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Elenco di id separati da virgole (posti scelti nel browser): solo uuid, senza doppioni. */
export function parseIdList(value: unknown, max = 500): string[] {
  if (typeof value !== "string") return [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = [...new Set(value.split(",").map((s) => s.trim().toLowerCase()))].filter((s) => uuid.test(s));
  return ids.slice(0, max);
}
