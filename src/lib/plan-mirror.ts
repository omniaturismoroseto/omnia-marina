// Numerazione di un pontile già disposto, girata senza ridisegnarlo: i posti (con i loro codici) si specchiano.
import type { Placement, Point } from "./plan";

export interface MirrorBerth {
  id: string;
  x: number;
  y: number;
  /** Gradi; a 0° il lato lungo è verticale. */
  angle: number;
}

/**
 * «estremi»: la numerazione parte dall'altra estremità (il posto 1 va dove c'era l'ultimo), ogni posto resta dal suo lato;
 * «lati»: i posti del lato sinistro passano a destra e viceversa, alla stessa altezza del pontile.
 * La linea a → b è quella del pontile (tracciata o ricavata dai posti). Distanze e angoli restano quelli di prima, specchiati.
 */
export function mirrorBerths(berths: MirrorBerth[], line: { a: Point; b: Point }, mode: "estremi" | "lati"): Placement[] {
  const len = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
  if (berths.length === 0 || len < 1) return [];
  const d = { x: (line.b.x - line.a.x) / len, y: (line.b.y - line.a.y) / len };
  // Asse dello specchio: per «lati» la linea del pontile; per «estremi» la perpendicolare a metà dei posti.
  let origin: Point;
  let axis: Point;
  if (mode === "lati") {
    origin = line.a;
    axis = d;
  } else {
    const along = berths.map((b) => (b.x - line.a.x) * d.x + (b.y - line.a.y) * d.y);
    const mid = (Math.min(...along) + Math.max(...along)) / 2;
    origin = { x: line.a.x + d.x * mid, y: line.a.y + d.y * mid };
    axis = { x: -d.y, y: d.x };
  }
  const reflect = (p: Point): Point => {
    const v = { x: p.x - origin.x, y: p.y - origin.y };
    const k = 2 * (v.x * axis.x + v.y * axis.y);
    return { x: origin.x + k * axis.x - v.x, y: origin.y + k * axis.y - v.y };
  };
  const round = (v: number, f: number) => Math.round(v * f) / f;
  return berths.map((b) => {
    const p = reflect({ x: b.x, y: b.y });
    // Lato lungo del posto specchiato rispetto allo stesso asse.
    const a = (b.angle * Math.PI) / 180;
    const v = { x: -Math.sin(a), y: Math.cos(a) };
    const k = 2 * (v.x * axis.x + v.y * axis.y);
    const w = { x: k * axis.x - v.x, y: k * axis.y - v.y };
    let angle = (Math.atan2(-w.x, w.y) * 180) / Math.PI;
    angle = round(angle <= -180 ? angle + 360 : angle, 100);
    return { id: b.id, x: round(p.x, 10), y: round(p.y, 10), angle };
  });
}
