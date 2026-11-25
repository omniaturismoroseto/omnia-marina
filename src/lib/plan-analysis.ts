// Dall'analisi automatica della foto alle proposte di pontili e banchine.
// Funzioni pure: nessun accesso a database o rete, così si possono provare con i test.

import { distance, layoutPier, type Mooring, type Placement, type Point } from "./plan";

// ───────────────────────── Risposta del modello ─────────────────────────

/** Punto come frazione dell'immagine, in millesimi: x da sinistra (0) a destra (1000), y dall'alto (0) in basso (1000). */
export interface AiPoint {
  x: number;
  y: number;
}

export interface AiSide {
  /** Un punto al centro della fila di barche di questo lato. */
  boats_point: AiPoint;
  /** Posti barca stimati sul lato (barche visibili più spazi liberi evidenti). */
  berths: number;
  /** Lunghezza tipica delle barche ormeggiate, in metri. */
  boat_length_m: number;
}

export interface AiStructure {
  name: string;
  kind: "pontile" | "banchina";
  /** Radice del pontile (o un'estremità della banchina). */
  start: AiPoint;
  /** Testata del pontile (o l'altra estremità). */
  end: AiPoint;
  /** Lunghezza stimata in metri, usata solo per proporre una scala se manca. */
  length_m: number;
  sides: AiSide[];
}

export interface AiAnalysis {
  structures: AiStructure[];
  notes: string;
}

// ───────────────────────── Proposte (in pixel della foto) ─────────────────────────

export type Side = "sx" | "dx";
export type StructureKind = "pontile" | "banchina";

export interface ProposalSide {
  side: Side;
  count: number;
  boatLengthCm: number;
}

export interface Proposal {
  name: string;
  kind: StructureKind;
  a: Point;
  b: Point;
  lengthM: number | null;
  sides: ProposalSide[];
}

export interface StoredAnalysis {
  /** Versione della foto analizzata: se la foto cambia, le proposte non valgono più. */
  photoVersion: number;
  proposals: Proposal[];
  notes: string;
  /** Pixel per metro stimati dall'analisi; si usano solo se l'utente non ha impostato la scala. */
  scaleEstimate: number | null;
}

export const MAX_BERTHS_PER_SIDE = 150;
const MIN_SEGMENT_PX = 8;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

function toPixels(p: AiPoint, width: number, height: number): Point {
  return { x: round1((clamp(p.x, 0, 1000) / 1000) * width), y: round1((clamp(p.y, 0, 1000) / 1000) * height) };
}

/**
 * Da che parte della linea a → b sta il punto p: "sx" a sinistra di chi cammina da a verso b, "dx" a destra.
 * Con l'asse y rivolto in basso (come sullo schermo) un prodotto vettoriale negativo indica la sinistra.
 */
export function sideOf(a: Point, b: Point, p: Point): Side {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return cross < 0 ? "sx" : "dx";
}

/** Converte la risposta del modello in proposte espresse in pixel della foto, scartando ciò che non ha senso. */
export function toProposals(analysis: AiAnalysis, width: number, height: number): Proposal[] {
  const proposals: Proposal[] = [];
  for (const s of analysis.structures) {
    const a = toPixels(s.start, width, height);
    const b = toPixels(s.end, width, height);
    if (distance(a, b) < MIN_SEGMENT_PX) continue;

    // Un lato per parte: se il modello ne indica due dalla stessa parte, si tiene quello con più posti.
    const bySide = new Map<Side, ProposalSide>();
    for (const side of s.sides) {
      const count = clamp(Math.round(side.berths), 0, MAX_BERTHS_PER_SIDE);
      if (count === 0) continue;
      const which = sideOf(a, b, toPixels(side.boats_point, width, height));
      const boatLengthCm = clamp(Math.round(side.boat_length_m * 100), 300, 6000);
      const existing = bySide.get(which);
      if (!existing || existing.count < count) bySide.set(which, { side: which, count, boatLengthCm });
    }
    if (bySide.size === 0) continue;

    const kind: StructureKind = s.kind === "banchina" ? "banchina" : "pontile";
    proposals.push({
      name: s.name.trim().slice(0, 60) || (kind === "banchina" ? "Banchina" : "Pontile"),
      kind,
      a,
      b,
      lengthM: Number.isFinite(s.length_m) && s.length_m > 0 ? round1(s.length_m) : null,
      sides: (["sx", "dx"] as const).flatMap((side) => (bySide.has(side) ? [bySide.get(side)!] : [])),
    });
  }
  return proposals;
}

/**
 * Scala proposta dall'analisi (pixel per metro): mediana del rapporto tra lunghezza disegnata e lunghezza stimata
 * delle strutture più lunghe di 10 m. È un valore indicativo: la scala misurata dall'utente ha sempre la precedenza.
 */
export function estimateScale(proposals: Proposal[]): number | null {
  const ratios = proposals
    .filter((p) => p.lengthM !== null && p.lengthM >= 10)
    .map((p) => distance(p.a, p.b) / p.lengthM!)
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((x, y) => x - y);
  if (ratios.length === 0) return null;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.round(median * 1000) / 1000;
}

/** Sigle libere da proporre (A, B, C… poi AA, AB…), saltando quelle già usate nel porto. */
export function suggestCodes(count: number, used: Iterable<string>): string[] {
  const taken = new Set([...used].map((c) => c.toUpperCase()));
  const codes: string[] = [];
  for (let i = 0; codes.length < count && i < 702; i++) {
    const code = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
    if (!taken.has(code)) codes.push(code);
  }
  return codes;
}

/** La categoria più piccola in cui sta una barca della lunghezza indicata; se nessuna basta, la più grande. */
export function categoryForLength<T extends { id: string; maxLengthCm: number }>(categories: T[], lengthCm: number): T | null {
  const sorted = [...categories].sort((x, y) => x.maxLengthCm - y.maxLengthCm);
  return sorted.find((c) => c.maxLengthCm >= lengthCm) ?? sorted[sorted.length - 1] ?? null;
}

// ───────────────────────── Dalle proposte ai posti ─────────────────────────

export interface PlannedSide {
  side: Side;
  count: number;
  lengthCm: number;
  beamCm: number;
}

export interface PlannedBerth {
  code: string;
  side: Side;
  position: number;
  lengthCm: number;
  beamCm: number;
  placement: Placement;
}

/** Larghezza con cui si disegna la struttura: i pontili hanno una passerella, le banchine no (le poppe toccano la linea). */
export function structureWidthM(kind: StructureKind): number {
  return kind === "pontile" ? 2 : 0;
}

/**
 * I posti di una struttura confermata: numerati di seguito (prima il lato sinistro, poi il destro),
 * con ogni lato che parte dalla radice, e già disposti sulla foto lungo la linea a → b (di prua o all'inglese).
 */
export function planBerths(
  code: string,
  kind: StructureKind,
  a: Point,
  b: Point,
  sides: PlannedSide[],
  pxPerMeter: number,
  mooring: Mooring = "punta",
): PlannedBerth[] {
  const ordered = [...sides].sort((x, y) => (x.side === y.side ? 0 : x.side === "sx" ? -1 : 1));
  const rows: Omit<PlannedBerth, "placement">[] = [];
  let n = 1;
  for (const side of ordered) {
    for (let position = 0; position < side.count; position++) {
      rows.push({ code: `${code}${n++}`, side: side.side, position, lengthCm: side.lengthCm, beamCm: side.beamCm });
    }
  }
  const placements = layoutPier(
    rows.map((r) => ({ id: r.code, side: r.side, position: r.position, lengthCm: r.lengthCm, beamCm: r.beamCm })),
    a,
    b,
    pxPerMeter,
    structureWidthM(kind),
    false,
    mooring,
  );
  const byCode = new Map(placements.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, placement: byCode.get(r.code)! }));
}
