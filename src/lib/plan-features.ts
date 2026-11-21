// Sfondo dello schema della mappa: terra, acqua, edifici, verde e servizi, in pixel della foto aerea.

import type { Point } from "./plan";
import { isServiceKey } from "./port-services";

export type FeatureKind = "terra" | "acqua" | "edificio" | "verde" | "servizio";
export type FeatureSource = "manuale" | "colori" | "claude";

export interface PlanFeature {
  id: string;
  kind: FeatureKind;
  service: string | null;
  name: string | null;
  points: Point[];
  source: FeatureSource;
}

export const FEATURE_LABEL: Record<FeatureKind, string> = {
  terra: "Terra",
  acqua: "Acqua",
  edificio: "Edificio",
  verde: "Verde",
  servizio: "Servizio",
};

// Ordine di disegno: prima terra e acqua (nell'ordine in cui sono state create, così l'acqua «scava» la terra), poi verde ed edifici.
const LAYER: Record<FeatureKind, number> = { terra: 0, acqua: 0, verde: 1, edificio: 2, servizio: 3 };

export function drawingOrder<T extends { kind: FeatureKind }>(features: T[]): T[] {
  return features.map((f, i) => ({ f, i })).sort((a, b) => LAYER[a.f.kind] - LAYER[b.f.kind] || a.i - b.i).map(({ f }) => f);
}

const round = (v: number) => Math.round(v * 10) / 10;

interface AiPointLike {
  x: number;
  y: number;
}

export interface AiSurroundingsLike {
  buildings: { name: string; outline: AiPointLike[] }[];
  green: { outline: AiPointLike[] }[];
  services: { type: string; name: string; at: AiPointLike }[];
}

/** Dalle proposte di Claude (millesimi della foto) agli elementi dello sfondo (pixel). */
export function surroundingsToFeatures(ai: AiSurroundingsLike, width: number, height: number): Omit<PlanFeature, "id">[] {
  const px = (p: AiPointLike): Point => ({
    x: round((Math.min(1000, Math.max(0, p.x)) / 1000) * width),
    y: round((Math.min(1000, Math.max(0, p.y)) / 1000) * height),
  });
  const polygon = (outline: AiPointLike[]) => {
    const pts = outline.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map(px);
    return pts.length >= 3 && polygonArea(pts) > 4 ? pts : null;
  };
  const result: Omit<PlanFeature, "id">[] = [];
  for (const g of ai.green.slice(0, 30)) {
    const pts = polygon(g.outline);
    if (pts) result.push({ kind: "verde", service: null, name: null, points: pts, source: "claude" });
  }
  for (const b of ai.buildings.slice(0, 80)) {
    const pts = polygon(b.outline);
    if (pts) result.push({ kind: "edificio", service: null, name: b.name.trim().slice(0, 80) || null, points: pts, source: "claude" });
  }
  for (const s of ai.services.slice(0, 60)) {
    if (!isServiceKey(s.type) || !Number.isFinite(s.at.x) || !Number.isFinite(s.at.y)) continue;
    result.push({ kind: "servizio", service: s.type, name: s.name.trim().slice(0, 80) || null, points: [px(s.at)], source: "claude" });
  }
  return result;
}

export function polygonArea(points: Point[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}

export function pathOf(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
}

type Box = { x: number; y: number; width: number; height: number };

/** Allarga l'area dello schema perché comprenda tutto lo sfondo disegnato, senza uscire dalla foto. */
export function extendBounds(bounds: Box, features: { points: Point[] }[], width: number, height: number): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of features) {
    for (const p of f.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX === Infinity) return bounds;
  // Lo sfondo resta dentro la foto; il riquadro dei posti si tiene comunque intero.
  const x = Math.min(bounds.x, Math.max(0, minX));
  const y = Math.min(bounds.y, Math.max(0, minY));
  const right = Math.max(bounds.x + bounds.width, Math.min(width, maxX));
  const bottom = Math.max(bounds.y + bounds.height, Math.min(height, maxY));
  return { x, y, width: right - x, height: bottom - y };
}
