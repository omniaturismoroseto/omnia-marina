// Pianta disegnata del porto: invece della foto, una planimetria pulita con acqua, terra, moli, pontili e posti.
// La forma della terra arriva dal riconoscimento automatico della foto; pontili e posti si ricavano dai posti disposti.
// Funzioni pure, in pixel della foto caricata (le stesse coordinate di berths.plan_x/plan_y).

import type { Point } from "./plan";
import type { AiPoint } from "./plan-analysis";

export type LandKind = "terra" | "molo" | "diga";

export interface LandShape {
  kind: LandKind;
  points: Point[];
}

/** Risposta del modello: contorni della terraferma in millesimi della foto. */
export interface AiDrawing {
  land: { kind: LandKind; points: AiPoint[] }[];
  notes: string;
}

/** Forma del porto salvata in `marina_plans.drawing`. */
export interface StoredDrawing {
  /** Versione della foto da cui è stata ricavata: con una foto nuova non vale più. */
  photoVersion: number;
  land: LandShape[];
  notes: string;
}

const MAX_SHAPES = 80;
const MAX_POINTS = 300;
// Fin dove si cerca la riva per attaccarci la radice di un pontile, in metri.
const MAX_ROOT_M = 60;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Converte i contorni del modello in pixel, scartando poligoni degeneri o minuscoli. */
export function toLandShapes(ai: AiDrawing, width: number, height: number): LandShape[] {
  const minArea = width * height * 0.00005;
  const shapes: LandShape[] = [];
  for (const shape of ai.land) {
    const kind: LandKind = shape.kind === "molo" || shape.kind === "diga" ? shape.kind : "terra";
    const points: Point[] = [];
    for (const p of shape.points.slice(0, MAX_POINTS)) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const q = { x: round1((clamp(p.x, 0, 1000) / 1000) * width), y: round1((clamp(p.y, 0, 1000) / 1000) * height) };
      const last = points[points.length - 1];
      if (!last || last.x !== q.x || last.y !== q.y) points.push(q);
    }
    if (points.length >= 3 && polygonArea(points) >= minArea) shapes.push({ kind, points });
    if (shapes.length >= MAX_SHAPES) break;
  }
  return shapes;
}

/** Il punto sta dentro il poligono (regola pari-dispari). */
export function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distanza del punto dalla terra più vicina (0 se ci sta sopra); Infinity senza terra. */
export function landDistance(p: Point, land: LandShape[]): number {
  let best = Infinity;
  for (const shape of land) {
    if (insidePolygon(p, shape.points)) return 0;
    for (let i = 0; i < shape.points.length; i++) {
      best = Math.min(best, segmentDistance(p, shape.points[i], shape.points[(i + 1) % shape.points.length]));
    }
  }
  return best;
}

// ───────────────────────── Pontili e posti ─────────────────────────

export interface DrawnBerthInput {
  id: string;
  pierId: string;
  side: "sx" | "dx";
  lengthCm: number;
  beamCm: number;
  planX: number | null;
  planY: number | null;
  planAngle: number | null;
}

export interface Walkway {
  pierId: string;
  /** I quattro spigoli della passerella (o del bordo di banchina). */
  corners: Point[];
  /** Dove scrivere la sigla: in fondo alla struttura, dalla parte dell'acqua. */
  label: Point;
}

export interface PierLayout {
  walkways: Walkway[];
  /**
   * Verso della prua di ogni posto, nel sistema del posto ruotato: +1 se la prua punta verso +y locale
   * (in basso a rotazione 0), -1 verso -y. La poppa sta dalla parte del pontile.
   */
  bow: Map<string, 1 | -1>;
}

interface Placed {
  id: string;
  side: "sx" | "dx";
  x: number;
  y: number;
  angle: number;
  w: number;
  l: number;
}

/** Angolo medio, a meno di mezzo giro (un posto ruotato di 180° è parallelo agli altri). */
function meanAxisAngle(angles: number[]): number {
  let c = 0;
  let s = 0;
  for (const a of angles) {
    const r = (a * Math.PI) / 90; // angolo doppio
    c += Math.cos(r);
    s += Math.sin(r);
  }
  return (Math.atan2(s, c) * 90) / Math.PI;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Ricava dai posti disposti la passerella di ogni pontile e il verso delle barche.
 * Due file di posti, una per parte: la passerella sta in mezzo. Una fila sola (banchina o pontile su un lato):
 * il bordo sta dalla parte della terra più vicina, oppure, senza forma della terra, dalla parte indicata dal lato.
 */
export function pierLayout(berths: DrawnBerthInput[], pxPerMeter: number, land: LandShape[] = []): PierLayout {
  const byPier = new Map<string, Placed[]>();
  for (const b of berths) {
    if (b.planX === null || b.planY === null) continue;
    const list = byPier.get(b.pierId) ?? [];
    list.push({
      id: b.id,
      side: b.side,
      x: b.planX,
      y: b.planY,
      angle: b.planAngle ?? 0,
      w: (b.beamCm / 100) * pxPerMeter,
      l: (b.lengthCm / 100) * pxPerMeter,
    });
    byPier.set(b.pierId, list);
  }

  const walkways: Walkway[] = [];
  const bow = new Map<string, 1 | -1>();
  const m = pxPerMeter;

  for (const [pierId, list] of byPier) {
    const theta = (meanAxisAngle(list.map((b) => b.angle)) * Math.PI) / 180;
    // d: lungo il pontile; n: lungo i posti (l'asse y locale di un posto a rotazione theta).
    const d = { x: Math.cos(theta), y: Math.sin(theta) };
    const n = { x: -Math.sin(theta), y: Math.cos(theta) };
    const c0 = { x: list.reduce((s, b) => s + b.x, 0) / list.length, y: list.reduce((s, b) => s + b.y, 0) / list.length };
    const at = (t: number, s: number): Point => ({ x: c0.x + d.x * t + n.x * s, y: c0.y + d.y * t + n.y * s });
    const rows = list.map((b) => {
      const v = { x: b.x - c0.x, y: b.y - c0.y };
      return { b, t: v.x * d.x + v.y * d.y, s: v.x * n.x + v.y * n.y, h: b.l / 2 };
    });

    // Verso di un posto rispetto a n: +1 se il posto è ruotato come la media, -1 se di mezzo giro.
    const flipOf = (b: Placed) => (Math.cos(((b.angle * Math.PI) / 180) - theta) >= 0 ? 1 : -1);
    const setBow = (b: Placed, outward: 1 | -1) => bow.set(b.id, (outward * flipOf(b)) as 1 | -1);

    const sMin = Math.min(...rows.map((r) => r.s));
    const sMax = Math.max(...rows.map((r) => r.s));
    const meanLength = rows.reduce((sum, r) => sum + r.h * 2, 0) / rows.length;
    let inner0: number;
    let inner1: number;
    if (sMax - sMin > meanLength * 0.9) {
      // Due file: quelle sotto la metà hanno la prua verso -n, le altre verso +n.
      const mid = (sMin + sMax) / 2;
      const low = rows.filter((r) => r.s < mid);
      const high = rows.filter((r) => r.s >= mid);
      for (const r of low) setBow(r.b, -1);
      for (const r of high) setBow(r.b, 1);
      const lowEdge = median(low.map((r) => r.s + r.h));
      const highEdge = median(high.map((r) => r.s - r.h));
      if (highEdge - lowEdge >= 0.8 * m) {
        inner0 = lowEdge;
        inner1 = highEdge;
      } else {
        const c = (lowEdge + highEdge) / 2;
        inner0 = c - m;
        inner1 = c + m;
      }
    } else {
      // Una fila: la poppa sta dalla parte σ (+1 = verso +n).
      let sigma: 1 | -1;
      const reach = meanLength / 2 + 4 * m;
      const plus = land.length ? landDistance(at(0, median(rows.map((r) => r.s)) + reach), land) : Infinity;
      const minus = land.length ? landDistance(at(0, median(rows.map((r) => r.s)) - reach), land) : Infinity;
      if (plus !== minus && Number.isFinite(Math.min(plus, minus))) {
        sigma = plus < minus ? 1 : -1;
      } else {
        // Come layoutPier: un posto "sx" sta a sinistra della linea, cioè dalla parte -n; la linea è dalla parte +n.
        const sx = rows.filter((r) => r.b.side === "sx").length;
        sigma = sx >= rows.length - sx ? 1 : -1;
      }
      for (const r of rows) setBow(r.b, (-sigma) as 1 | -1);
      const edge = median(rows.map((r) => r.s + sigma * r.h));
      // Bordo di banchina o passerella di un pontile con un lato solo.
      const width = 2.5 * m;
      inner0 = sigma > 0 ? edge : edge - width;
      inner1 = sigma > 0 ? edge + width : edge;
    }

    let tMin = Math.min(...rows.map((r) => r.t - r.b.w / 2)) - m;
    let tMax = Math.max(...rows.map((r) => r.t + r.b.w / 2)) + m;
    const sMid = (inner0 + inner1) / 2;
    // La radice: un pontile si attacca alla terra, quindi la passerella si allunga fino alla riva più vicina.
    if (land.length && landDistance(at((tMin + tMax) / 2, sMid), land) > 0) {
      const reachLand = (from: number, dir: 1 | -1): number | null => {
        for (let step = 0.5 * m; step <= MAX_ROOT_M * m; step += 0.5 * m) {
          if (landDistance(at(from + dir * step, sMid), land) === 0) return step;
        }
        return null;
      };
      const back = reachLand(tMin, -1);
      const ahead = reachLand(tMax, 1);
      if (back !== null && (ahead === null || back <= ahead)) tMin -= back + 0.5 * m;
      else if (ahead !== null) tMax += ahead + 0.5 * m;
    }
    const corners = [at(tMin, inner0), at(tMax, inner0), at(tMax, inner1), at(tMin, inner1)];
    const gap = 3.5 * m;
    const endA = at(tMin - gap, sMid);
    const endB = at(tMax + gap, sMid);
    const label = land.length && landDistance(endA, land) > landDistance(endB, land) ? endA : endB;
    walkways.push({ pierId, corners, label });
  }
  return { walkways, bow };
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Riquadro da mostrare: i posti e le passerelle, con un margine d'acqua e di terra intorno,
 * senza uscire dalla foto. Senza posti disposti, tutta la foto.
 */
export function drawingBounds(berths: DrawnBerthInput[], walkways: Walkway[], pxPerMeter: number, width: number, height: number): Bounds {
  const points: Point[] = walkways.flatMap((w) => w.corners);
  for (const b of berths) {
    if (b.planX === null || b.planY === null) continue;
    const r = (Math.hypot(b.beamCm, b.lengthCm) / 200) * pxPerMeter;
    points.push({ x: b.planX - r, y: b.planY - r }, { x: b.planX + r, y: b.planY + r });
  }
  if (points.length === 0) return { x: 0, y: 0, w: width, h: height };
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const margin = Math.max(0.12 * Math.max(maxX - minX, maxY - minY), 20 * pxPerMeter);
  const x0 = clamp(minX - margin, 0, width);
  const y0 = clamp(minY - margin, 0, height);
  const x1 = clamp(maxX + margin, 0, width);
  const y1 = clamp(maxY + margin, 0, height);
  if (x1 - x0 < 1 || y1 - y0 < 1) return { x: 0, y: 0, w: width, h: height };
  return { x: round1(x0), y: round1(y0), w: round1(x1 - x0), h: round1(y1 - y0) };
}

/** Lunghezza «tonda» della barra della scala, in metri, vicina a una frazione della larghezza mostrata. */
export function scaleBarMeters(viewWidthPx: number, pxPerMeter: number): number {
  const target = (viewWidthPx * 0.16) / pxPerMeter;
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  return steps.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), steps[0]);
}

/** Sagoma di una barca dentro il posto, nel sistema del posto (centro in 0,0), con la prua verso -y. */
export function boatPath(w: number, l: number): string {
  const bw = w * 0.34;
  const half = l * 0.45;
  const bowStart = -half + l * 0.3;
  const f = round1;
  return [
    `M ${f(-bw)} ${f(half)}`,
    `L ${f(-bw)} ${f(bowStart)}`,
    `Q ${f(-bw)} ${f(-half + l * 0.08)} 0 ${f(-half)}`,
    `Q ${f(bw)} ${f(-half + l * 0.08)} ${f(bw)} ${f(bowStart)}`,
    `L ${f(bw)} ${f(half)}`,
    "Z",
  ].join(" ");
}
