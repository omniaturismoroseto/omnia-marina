import { describe, expect, it } from "vitest";
import { layoutPier, type PlanBerth } from "../src/lib/plan";
import { mirrorBerths } from "../src/lib/plan-mirror";

const M = 10;
const berth = (id: string, side: "sx" | "dx", position: number): PlanBerth => ({ id, side, position, lengthCm: 1000, beamCm: 400 });
const a = { x: 100, y: 500 };
const b = { x: 500, y: 500 };
const list = [berth("R1", "sx", 0), berth("R2", "sx", 1), berth("R3", "sx", 2), berth("R4", "dx", 0), berth("R5", "dx", 1), berth("R6", "dx", 2)];
const placed = layoutPier(list, a, b, M);
const at = (ps: { id: string; x: number; y: number }[]) => Object.fromEntries(ps.map((p) => [p.id, p]));

describe("numerazione girata", () => {
  it("dall'altra estremità: il primo va dove c'era l'ultimo, stesso lato", () => {
    const before = at(placed);
    const after = at(mirrorBerths(placed, { a, b }, "estremi"));
    expect(after.R1.x).toBeCloseTo(before.R3.x, 5);
    expect(after.R1.y).toBeCloseTo(before.R1.y, 5);
    expect(after.R4.x).toBeCloseTo(before.R6.x, 5);
  });

  it("lati scambiati: stessi punti lungo il pontile, dall'altra parte", () => {
    const before = at(placed);
    const after = at(mirrorBerths(placed, { a, b }, "lati"));
    expect(after.R1.x).toBeCloseTo(before.R1.x, 5);
    expect(after.R1.y).toBeCloseTo(before.R4.y, 5);
    expect(after.R4.y).toBeCloseTo(before.R1.y, 5);
  });

  it("all'inglese le barche restano di fianco al pontile", () => {
    const inglese = layoutPier(list, a, b, M, 2, false, "inglese");
    for (const p of mirrorBerths(inglese, { a, b }, "estremi")) expect(Math.abs(Math.abs(p.angle) - 90)).toBeLessThan(0.01);
  });
});
