// Regole pure per unire i pontili e per riordinarli: le usa src/server/piers.ts.

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
