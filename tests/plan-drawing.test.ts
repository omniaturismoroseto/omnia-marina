import { describe, expect, it } from "vitest";
import { layoutPier, type PlanBerth, type Point } from "../src/lib/plan";
import { boatPath, buildDrawing, type DrawingBerth, type DrawingPier } from "../src/lib/plan-drawing";

const M = 10; // pixel per metro
const berth = (id: string, side: "sx" | "dx", position: number): PlanBerth => ({ id, side, position, lengthCm: 1000, beamCm: 350 });

// Posti disposti come fa l'editor, pronti per il disegno.
function placed(list: PlanBerth[], a: Point, b: Point, widthM = 2, flip = false): DrawingBerth[] {
  const byId = new Map(list.map((x) => [x.id, x]));
  return layoutPier(list, a, b, M, widthM, flip).map((p) => ({ ...byId.get(p.id)!, x: p.x, y: p.y, angle: p.angle }));
}

const bbox = (points: Point[]) => ({
  minX: Math.min(...points.map((p) => p.x)),
  maxX: Math.max(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxY: Math.max(...points.map((p) => p.y)),
});

describe("schema disegnato del porto", () => {
  const a = { x: 100, y: 500 };
  const b = { x: 300, y: 500 };
  const twoSides = [berth("s1", "sx", 0), berth("d1", "dx", 0), berth("s2", "sx", 1), berth("d2", "dx", 1)];

  it("pontile tracciato: poppe verso la linea, striscia larga quanto la passerella", () => {
    const pier: DrawingPier = { id: "p", name: "Pontile A", trace: { a, b, widthM: 2 }, berths: placed(twoSides, a, b) };
    const d = buildDrawing([pier], M)!;
    // sx sta sopra (y minori): la poppa è verso la y positiva del posto; dx al contrario.
    expect(d.stern.get("s1")).toBe(1);
    expect(d.stern.get("d1")).toBe(-1);
    const box = bbox(d.piers[0].outline);
    expect(box.minY).toBeCloseTo(490);
    expect(box.maxY).toBeCloseTo(510);
    expect(box.minX).toBeLessThanOrEqual(100);
    expect(box.maxX).toBeGreaterThanOrEqual(300);
    // Il nome va oltre la testata (a destra).
    expect(d.piers[0].label.x).toBeGreaterThan(300);
    expect(d.piers[0].label.anchor).toBe("start");
  });

  it("pontile mai tracciato: la linea si ricava dai due lati che si guardano", () => {
    const pier: DrawingPier = { id: "p", name: "Pontile A", trace: null, berths: placed(twoSides, a, b) };
    const d = buildDrawing([pier], M)!;
    expect(d.stern.get("s2")).toBe(1);
    expect(d.stern.get("d2")).toBe(-1);
    const box = bbox(d.piers[0].outline);
    expect(box.minY).toBeCloseTo(490);
    expect(box.maxY).toBeCloseTo(510);
  });

  it("banchina tracciata con i lati invertiti: la terra sta dietro le poppe", () => {
    const quay = [berth("t1", "sx", 0), berth("t2", "sx", 1)];
    // Con flip i posti «sx» finiscono sotto la linea.
    const berths = placed(quay, a, b, 0, true);
    expect(berths[0].y).toBeGreaterThan(500);
    const d = buildDrawing([{ id: "q", name: "Banchina", trace: { a, b, widthM: 0 }, berths }], M)!;
    expect(d.stern.get("t1")).toBe(-1);
    const box = bbox(d.piers[0].outline);
    expect(box.maxY).toBeCloseTo(500);
    expect(box.minY).toBeCloseTo(470);
  });

  it("un lato solo senza linea: vale la regola del tracciamento (sx a sinistra)", () => {
    const one = [berth("t1", "sx", 0), berth("t2", "sx", 1)];
    const d = buildDrawing([{ id: "q", name: "Banchina", trace: null, berths: placed(one, a, b, 0) }], M)!;
    expect(d.stern.get("t1")).toBe(1);
    const box = bbox(d.piers[0].outline);
    expect(box.minY).toBeCloseTo(500);
    expect(box.maxY).toBeCloseTo(530);
  });

  it("il riquadro contiene tutti i posti e i pontili", () => {
    const pier: DrawingPier = { id: "p", name: "A", trace: { a, b, widthM: 2 }, berths: placed(twoSides, a, b) };
    const { bounds } = buildDrawing([pier], M)!;
    expect(bounds.x).toBeLessThan(100);
    expect(bounds.y).toBeLessThan(440 - 50);
    expect(bounds.x + bounds.width).toBeGreaterThan(300);
    expect(bounds.y + bounds.height).toBeGreaterThan(560 + 50);
  });

  it("senza posti non c'è niente da disegnare", () => {
    expect(buildDrawing([{ id: "p", name: "A", trace: null, berths: [] }], M)).toBeNull();
  });

  it("la sagoma della barca è lunga e larga quanto richiesto", () => {
    const d = boatPath(100, 40);
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = numbers.filter((_, i) => i % 2 === 0);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100);
  });
});
