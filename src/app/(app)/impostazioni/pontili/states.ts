import type { BerthState } from "@/server/board";

// Colori dei posti come sulla mappa (src/app/(app)/mappa/page.tsx), per riconoscerli a colpo d'occhio.
export const STATE_CELL: Record<BerthState, string> = {
  libero: "border-ok/50 bg-ok-soft text-ok",
  occupato: "border-sea-dark bg-sea text-white",
  fuori: "hatch border-sea/60 bg-card text-sea-dark",
  atteso: "border-warn/60 bg-warn-soft text-warn",
  partenza: "border-buoy-dark bg-buoy text-white",
  ritardo: "border-bad bg-bad text-white",
  fermo: "border-line bg-line-soft text-faint",
};

export const STATE_ORDER: BerthState[] = ["libero", "occupato", "fuori", "atteso", "partenza", "ritardo", "fermo"];

/** Occupati, liberi e non disponibili di un gruppo di posti (barca fuori, in arrivo, in partenza e oltre scadenza contano come occupati). */
export function stateCounts(list: { state: BerthState }[]) {
  const free = list.filter((b) => b.state === "libero").length;
  const stopped = list.filter((b) => b.state === "fermo").length;
  return { total: list.length, free, stopped, busy: list.length - free - stopped };
}
