// Moduli della pianta: pezzi staccati di un pontile (o tratto). Si riconoscono per vicinanza una volta sola, poi restano fissi
// (berths.plan_module): avvicinando due moduli nell'editor non diventano uno.

export interface ModuleBerth {
  id: string;
  /** Struttura (pontile o tratto) a cui appartiene il posto: i moduli non la attraversano. */
  unit: string;
  x: number;
  y: number;
  /** Rotazione in gradi (a 0° il lato lungo è verticale). */
  angle: number;
  /** Lunghezza e larghezza del posto in pixel della foto. */
  l: number;
  w: number;
  module: number | null;
}

/**
 * Due posti sono dello stesso modulo se sono orientati allo stesso modo e affiancati sulla stessa fila (uno accanto all'altro,
 * senza sfalsamento) oppure uno di fronte all'altro sulla stessa passerella. Due file vicine ma sfalsate restano moduli diversi.
 */
export function nearBerths(a: ModuleBerth, b: ModuleBerth, meterPx: number): boolean {
  const turn = ((((a.angle - b.angle) % 180) + 180) % 180);
  if (Math.min(turn, 180 - turn) > 20) return false;
  const r = (a.angle * Math.PI) / 180;
  const along = { x: Math.cos(r), y: Math.sin(r) }; // lungo il pontile
  const across = { x: -Math.sin(r), y: Math.cos(r) }; // lungo il posto
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.abs(dx * along.x + dy * along.y);
  const n = Math.abs(dx * across.x + dy * across.y);
  const L = (a.l + b.l) / 2;
  const W = (a.w + b.w) / 2;
  const sideBySide = n <= 0.35 * L && t <= W + 1.5 * meterPx;
  const facing = t <= 0.6 * W && n <= L + 4 * meterPx;
  return sideBySide || facing;
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
