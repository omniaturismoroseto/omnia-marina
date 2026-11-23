import { describe, expect, it } from "vitest";
import { alignRows, type AlignBerth } from "@/lib/plan-align";

// 10 px per metro; posti da 10 × 4 m (100 × 40 px), pontile orizzontale (posti a 0°).
const b = (code: string, x: number, y: number, angle = 0): AlignBerth => ({ id: code, code, x, y, angle, lengthCm: 1000, beamCm: 400 });

describe("allinea in fila", () => {
  it("rimette dritta una fila storta: stessa linea, passo uguale, stesso angolo, in ordine di codice", () => {
    const out = alignRows([b("R1", 0, 3, 4), b("R3", 95, -6, -5), b("R2", 52, 8, 2), b("R4", 150, 0, 1)], 10);
    const at = Object.fromEntries(out.map((p) => [p.id, p]));
    // Tutti sulla retta tra il primo e l'ultimo (scarto sotto 1 px).
    const slope = (at.R4.y - at.R1.y) / (at.R4.x - at.R1.x);
    for (const p of out) expect(Math.abs(at.R1.y + slope * (p.x - at.R1.x) - p.y)).toBeLessThan(1);
    expect(new Set(out.map((p) => p.angle)).size).toBe(1);
    expect(at.R2.x - at.R1.x).toBeCloseTo(at.R3.x - at.R2.x, 0);
    expect(at.R3.x - at.R2.x).toBeCloseTo(at.R4.x - at.R3.x, 0);
    expect(at.R1.x).toBeLessThan(at.R2.x);
  });

  it("posti accavallati si distanziano almeno della loro larghezza", () => {
    const out = alignRows([b("A1", 0, 0), b("A2", 10, 0), b("A3", 20, 0)], 10);
    expect(out[1].x - out[0].x).toBeGreaterThanOrEqual(42);
  });

  it("due file una di fronte all'altra restano due file, allineate dalla stessa radice", () => {
    const out = alignRows([b("S1", 0, 0), b("S2", 45, 4), b("D1", 3, 125), b("D2", 50, 118)], 10);
    const at = Object.fromEntries(out.map((p) => [p.id, p]));
    expect(Math.abs(at.S1.y - at.S2.y)).toBeLessThan(1);
    expect(Math.abs(at.D1.y - at.D2.y)).toBeLessThan(1);
    expect(at.D1.y - at.S1.y).toBeGreaterThan(100);
    expect(at.S1.x).toBeCloseTo(at.D1.x, 0);
  });

  it("con meno di due posti non fa niente", () => {
    expect(alignRows([b("A1", 0, 0)], 10)).toEqual([]);
  });
});
