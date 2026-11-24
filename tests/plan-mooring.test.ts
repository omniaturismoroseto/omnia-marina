import { describe, expect, it } from "vitest";
import { isAlongside, layoutPier, rowAxis, type PlanBerth } from "../src/lib/plan";
import { alignRows } from "../src/lib/plan-align";
import { buildDrawing } from "../src/lib/plan-drawing";
import { placeNewBerths } from "../src/lib/plan-extend";

const M = 10; // pixel per metro
const withSizes = <T extends object>(list: T[]) => list.map((p) => ({ ...p, lengthCm: 1000, beamCm: 400 }));
const berth = (id: string, side: "sx" | "dx", position: number): PlanBerth => ({ id, side, position, lengthCm: 1000, beamCm: 400 });

describe("ormeggio all'inglese", () => {
  const a = { x: 100, y: 500 };
  const b = { x: 500, y: 500 };
  const list = [berth("s1", "sx", 0), berth("s2", "sx", 1), berth("s3", "sx", 2), berth("d1", "dx", 0), berth("d2", "dx", 1)];

  it("le barche stanno di fianco al pontile, una dietro l'altra, a mezza larghezza dalla passerella", () => {
    const placed = layoutPier(list, a, b, M, 2, false, "inglese");
    const at = Object.fromEntries(placed.map((p) => [p.id, p]));
    // Lato lungo orizzontale, come il pontile.
    for (const p of placed) expect(isAlongside(p.angle, { x: 1, y: 0 })).toBe(true);
    // sx sopra la linea: 1 m di passerella + 2 m di mezza larghezza.
    expect(at.s1.y).toBe(470);
    expect(at.d1.y).toBe(530);
    expect(at.s2.x - at.s1.x).toBeGreaterThanOrEqual(100);
  });

  it("di punta resta com'era", () => {
    const placed = layoutPier(list, a, b, M, 2);
    for (const p of placed) expect(isAlongside(p.angle, { x: 1, y: 0 })).toBe(false);
  });

  it("dai posti si riconosce la fila: di punta o all'inglese", () => {
    const inglese = layoutPier(list, a, b, M, 2, false, "inglese");
    const axis = rowAxis(withSizes(inglese), M);
    expect(axis.mooring).toBe("inglese");
    expect(Math.abs(axis.d.x)).toBeCloseTo(1, 5);
    expect(rowAxis(withSizes(layoutPier(list, a, b, M, 2)), M).mooring).toBe("punta");
  });

  it("«Allinea in fila» raddrizza una fila all'inglese storta senza girare le barche", () => {
    const crooked = [
      { id: "s1", x: 150, y: 472, angle: 88 },
      { id: "s2", x: 262, y: 466, angle: 93 },
      { id: "s3", x: 371, y: 475, angle: 90 },
    ];
    const out = alignRows(
      crooked.map((p) => ({ ...p, code: p.id, lengthCm: 1000, beamCm: 400 })),
      M,
    );
    const ys = out.map((p) => p.y);
    // Dritta lungo l'orientamento medio delle barche (90,3°): su 22 m scarta poco più di un pixel.
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(2);
    const xs = out.map((p) => p.x).sort((p, q) => p - q);
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(100);
    for (const p of out) expect(isAlongside(p.angle, { x: 1, y: 0 })).toBe(true);
  });

  it("nello schema il pontile copre la lunghezza delle barche, anche senza linea", () => {
    const placed = layoutPier(list, a, b, M, 2, false, "inglese");
    const berths = placed.map((p) => ({ ...list.find((x) => x.id === p.id)!, x: p.x, y: p.y, angle: p.angle }));
    for (const trace of [{ a, b, widthM: 2 }, null]) {
      const drawing = buildDrawing([{ id: "p", name: "P", trace, berths }], M)!;
      const xs = drawing.piers[0].outline.map((q) => q.x);
      const ys = drawing.piers[0].outline.map((q) => q.y);
      // Lungo il pontile (orizzontale) e sottile di traverso.
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(300);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(40);
      expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(500, -1);
    }
  });

  it("i posti nuovi proseguono all'inglese dopo quelli che ci sono", () => {
    const placed = layoutPier(list.slice(0, 3), a, b, M, 2, false, "inglese");
    const existing = placed.map((p) => ({ ...list.find((x) => x.id === p.id)!, x: p.x, y: p.y, angle: p.angle }));
    const [next] = placeNewBerths(existing, [{ ...berth("s4", "sx", 3) }], { a, b, widthM: 2 }, M);
    expect(next.y).toBeCloseTo(470, 0);
    expect(isAlongside(next.angle, { x: 1, y: 0 })).toBe(true);
    expect(next.x).toBeGreaterThan(Math.max(...existing.map((e) => e.x)));
  });
});
