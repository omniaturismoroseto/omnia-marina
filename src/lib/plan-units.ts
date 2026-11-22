// Strutture della pianta: ogni pontile è una struttura, ma un pontile unito ad altri ne ha una per tratto (pier_sections),
// con la sua linea e i suoi posti. Editor della pianta e schema della mappa lavorano su queste, non sui pontili.

export interface UnitTrace {
  a: { x: number; y: number };
  b: { x: number; y: number };
  widthM: number;
}

export interface UnitSection {
  id: string;
  label: string;
  trace: UnitTrace | null;
}

export interface UnitPier {
  id: string;
  name: string;
  trace: UnitTrace | null;
  sections: UnitSection[];
}

export interface PlanUnit<B> {
  /** Id del tratto, o del pontile se non è diviso in tratti. */
  id: string;
  pierId: string;
  /** Nome del pontile; per un tratto «Nome · tratto CN». */
  name: string;
  pierName: string;
  trace: UnitTrace | null;
  berths: B[];
}

/** Linea dalle colonne del database (plan_ax…); null se non è stata tracciata. */
export function traceFromColumns(r: {
  planAx: number | null;
  planAy: number | null;
  planBx: number | null;
  planBy: number | null;
  planWidthM: number | null;
}): UnitTrace | null {
  return r.planAx !== null && r.planAy !== null && r.planBx !== null && r.planBy !== null
    ? { a: { x: r.planAx, y: r.planAy }, b: { x: r.planBx, y: r.planBy }, widthM: r.planWidthM ?? 2 }
    : null;
}

/**
 * Strutture nell'ordine dei pontili: per un pontile con tratti, un'unità per tratto più (se ci sono) i posti fuori dai tratti
 * con la linea del pontile; per gli altri, il pontile intero.
 */
export function planUnits<B extends { pierId: string; sectionId: string | null }>(piers: UnitPier[], berths: B[]): PlanUnit<B>[] {
  const units: PlanUnit<B>[] = [];
  for (const pier of piers) {
    const own = berths.filter((b) => b.pierId === pier.id);
    const sectionIds = new Set(pier.sections.map((s) => s.id));
    for (const s of pier.sections) {
      units.push({
        id: s.id,
        pierId: pier.id,
        name: `${pier.name} · tratto ${s.label}`,
        pierName: pier.name,
        trace: s.trace,
        berths: own.filter((b) => b.sectionId === s.id),
      });
    }
    const loose = own.filter((b) => !b.sectionId || !sectionIds.has(b.sectionId));
    if (pier.sections.length === 0 || loose.length > 0 || pier.trace) {
      units.push({ id: pier.id, pierId: pier.id, name: pier.name, pierName: pier.name, trace: pier.trace, berths: loose });
    }
  }
  return units;
}

/**
 * Posizioni dei posti dentro la loro struttura, lato per lato, dalla radice (0, 1, 2…): in un pontile unito le posizioni salvate
 * proseguono dopo quelle del primo tratto, ma per tracciare un tratto contano solo i suoi posti.
 */
export function unitPositions<B extends { id: string; side: "sx" | "dx"; position: number }>(berths: B[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const side of ["sx", "dx"] as const) {
    berths
      .filter((b) => b.side === side)
      .sort((p, q) => p.position - q.position)
      .forEach((b, i) => result.set(b.id, i));
  }
  return result;
}
