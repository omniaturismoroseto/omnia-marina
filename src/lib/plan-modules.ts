// Moduli della pianta: pezzi staccati di un pontile (o tratto). Si riconoscono per vicinanza una volta sola, poi restano fissi
// (berths.plan_module): avvicinando due moduli nell'editor non diventano uno.

export interface ModuleBerth {
  id: string;
  /** Struttura (pontile o tratto) a cui appartiene il posto: i moduli non la attraversano. */
  unit: string;
  x: number;
  y: number;
  /** Lunghezza e larghezza del posto in pixel della foto. */
  l: number;
  w: number;
  module: number | null;
}

/** Due posti sono dello stesso modulo se sono affiancati o uno di fronte all'altro sulla stessa passerella. */
export function nearBerths(a: ModuleBerth, b: ModuleBerth, meterPx: number): boolean {
  const limit = Math.max((a.l + b.l) / 2, (a.w + b.w) / 2) + 3 * meterPx;
  return Math.hypot(a.x - b.x, a.y - b.y) <= limit;
}

/**
 * Modulo di ogni posto. Chi lo ha già lo tiene. I posti senza modulo si raggruppano per vicinanza tra loro; un gruppo vicino a
 * un modulo esistente della stessa struttura ci entra (es. posti aggiunti in coda), altrimenti diventa un modulo nuovo.
 */
export function assignModules(berths: ModuleBerth[], meterPx: number): Map<string, number> {
  const result = new Map<string, number>();
  const units = new Map<string, ModuleBerth[]>();
  for (const b of berths) units.set(b.unit, [...(units.get(b.unit) ?? []), b]);

  for (const list of units.values()) {
    const known = list.filter((b) => b.module !== null);
    for (const b of known) result.set(b.id, b.module!);
    let next = known.reduce((max, b) => Math.max(max, b.module!), 0) + 1;
    const loose = list.filter((b) => b.module === null);
    const seen = new Set<string>();
    for (const start of loose) {
      if (seen.has(start.id)) continue;
      const cluster = [start];
      seen.add(start.id);
      for (let i = 0; i < cluster.length; i++) {
        for (const other of loose) {
          if (!seen.has(other.id) && nearBerths(cluster[i], other, meterPx)) {
            seen.add(other.id);
            cluster.push(other);
          }
        }
      }
      const joined = known.find((k) => cluster.some((c) => nearBerths(c, k, meterPx)));
      const id = joined ? joined.module! : next++;
      for (const c of cluster) result.set(c.id, id);
    }
  }
  return result;
}
