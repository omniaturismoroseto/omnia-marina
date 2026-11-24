// Schema dei posti di un pontile in Impostazioni → Pontili e posti: i posti si mostrano modulo per modulo (le parti staccate
// riconosciute sulla pianta), così una banchina lunga non sembra più pontili. Funzioni pure, provate nei test.

import { compareCodes } from "./berth-codes";

export interface StripBerth {
  id: string;
  code: string;
  side: "sx" | "dx";
  position: number;
  module: number | null;
}

export interface StripModule<B extends StripBerth> {
  /** Modulo della pianta; null se i posti non sono ancora sulla pianta. */
  module: number | null;
  berths: B[];
  /** Colonna di ogni posto, lato per lato, dalla radice del modulo (0, 1, 2…). */
  columns: Map<string, number>;
  /** Quante colonne servono. */
  span: number;
}

/** Posti divisi per modulo, in ordine del primo codice; i posti senza modulo (fuori pianta) formano un gruppo a sé, in fondo. */
export function stripModules<B extends StripBerth>(berths: B[]): StripModule<B>[] {
  const groups = new Map<number | null, B[]>();
  for (const b of berths) groups.set(b.module, [...(groups.get(b.module) ?? []), b]);
  const firstCode = (list: B[]) => [...list].sort((p, q) => compareCodes(p.code, q.code))[0].code;
  return [...groups.entries()]
    .sort(([ma, a], [mb, b]) => (ma === null ? 1 : mb === null ? -1 : compareCodes(firstCode(a), firstCode(b))))
    .map(([module, list]) => {
      const columns = new Map<string, number>();
      for (const side of ["sx", "dx"] as const) {
        list
          .filter((b) => b.side === side)
          .sort((p, q) => p.position - q.position || compareCodes(p.code, q.code))
          .forEach((b, i) => columns.set(b.id, i));
      }
      const span = Math.max(1, ...list.map((b) => columns.get(b.id)! + 1));
      return { module, berths: list, columns, span };
    });
}

/** «R1–R11 · R23–R33»: i codici di un modulo, lato per lato. */
export function moduleCodes(berths: StripBerth[]): string {
  const range = (side: "sx" | "dx") => {
    const list = berths.filter((b) => b.side === side).sort((p, q) => compareCodes(p.code, q.code));
    if (list.length === 0) return "";
    return list.length === 1 ? list[0].code : `${list[0].code}–${list[list.length - 1].code}`;
  };
  return [range("sx"), range("dx")].filter(Boolean).join(" · ");
}
