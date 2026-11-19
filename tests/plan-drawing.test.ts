import { describe, expect, it } from "vitest";
import { layoutPier } from "../src/lib/plan";
import { drawingBounds, insidePolygon, landDistance, pierLayout, scaleBarMeters, toLandShapes, type DrawnBerthInput, type LandShape } from "../src/lib/plan-drawing";

const PX = 10; // 10 pixel per metro

// Posti disposti come fa l'editor: pontile orizzontale da (100, 500) a (400, 500).
function pier(sides: ("sx" | "dx")[], perSide: number, pierId = "p1", a = { x: 100, y: 500 }, b = { x: 400, y: 500 }, widthM = 2): DrawnBerthInput[] {
  const list = sides.flatMap((side) => Array.from({ length: perSide }, (_, position) => ({ id: `${pierId}-${side}${position}`, side, position, lengthCm: 1000, beamCm: 350 })));
  const placed = new Map(layoutPier(list, a, b, PX, widthM).map((p) => [p.id, p]));
  return list.map((berth) => {
    const p = placed.get(berth.id)!;
    return { ...berth, pierId, planX: p.x, planY: p.y, planAngle: p.angle };
  });
}

describe("forma della terra", () => {
  it("converte i millesimi in pixel e scarta poligoni degeneri", () => {
    const shapes = toLandShapes(
      {
        land: [
          { kind: "terra", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 100 }, { x: 0, y: 100 }] },
          { kind: "molo", points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] },
          { kind: "diga", points: [{ x: 500, y: 500 }, { x: 500.01, y: 500 }, { x: 500, y: 500.01 }] },
        ],
        notes: "",
      },
      2000,
      1000,
    );
    expect(shapes).toEqual([{ kind: "terra", points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 100 }, { x: 0, y: 100 }] }]);
  });

  it("distanza dalla terra: zero sopra, positiva in acqua", () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(insidePolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(landDistance({ x: 5, y: 5 }, [{ kind: "terra", points: square }])).toBe(0);
    expect(landDistance({ x: 5, y: 15 }, [{ kind: "terra", points: square }])).toBeCloseTo(5);
    expect(landDistance({ x: 5, y: 15 }, [])).toBe(Infinity);
  });
});

describe("pontili ricavati dai posti", () => {
  it("con due file la passerella sta in mezzo e le prue puntano verso l'acqua", () => {
    const berths = pier(["sx", "dx"], 6);
    const { walkways, bow } = pierLayout(berths, PX);
    expect(walkways).toHaveLength(1);
    const ys = walkways[0].corners.map((c) => c.y);
    // Passerella larga 2 m intorno alla linea y = 500.
    expect(Math.min(...ys)).toBeCloseTo(490, 0);
    expect(Math.max(...ys)).toBeCloseTo(510, 0);
    // Lato sinistro sopra (y minori): prua verso l'alto, cioè -y locale a rotazione 0.
    expect(bow.get("p1-sx0")).toBe(-1);
    expect(bow.get("p1-dx0")).toBe(1);
  });

  it("una fila sola si appoggia alla terra più vicina", () => {
    // Banchina: posti sotto la linea y = 500, terra sopra.
    const berths = pier(["dx"], 5, "b1", { x: 100, y: 500 }, { x: 400, y: 500 }, 0);
    const land: LandShape[] = [{ kind: "terra", points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 500 }, { x: 0, y: 500 }] }];
    const { walkways, bow } = pierLayout(berths, PX, land);
    const ys = walkways[0].corners.map((c) => c.y);
    expect(Math.max(...ys)).toBeCloseTo(500, 0);
    expect(bow.get("b1-dx0")).toBe(1); // prua verso il basso, lontano dalla banchina
  });

  it("senza forma della terra, una fila sola usa il lato del posto", () => {
    const berths = pier(["sx"], 4);
    const { walkways, bow } = pierLayout(berths, PX);
    expect(Math.max(...walkways[0].corners.map((c) => c.y))).toBeGreaterThan(berths[0].planY!);
    expect(bow.get("p1-sx0")).toBe(-1);
  });

  it("la radice del pontile si allunga fino alla riva", () => {
    const berths = pier(["sx", "dx"], 4, "p1", { x: 150, y: 500 }, { x: 400, y: 500 });
    const land: LandShape[] = [{ kind: "terra", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 1000 }, { x: 0, y: 1000 }] }];
    const { walkways } = pierLayout(berths, PX, land);
    expect(Math.min(...walkways[0].corners.map((c) => c.x))).toBeLessThanOrEqual(100);
    // La sigla va in testata, dalla parte dell'acqua.
    expect(walkways[0].label.x).toBeGreaterThan(400);
  });

  it("ignora i posti non disposti", () => {
    const berths = [...pier(["sx"], 2), { id: "x", pierId: "p2", side: "sx" as const, lengthCm: 800, beamCm: 300, planX: null, planY: null, planAngle: null }];
    expect(pierLayout(berths, PX).walkways.map((w) => w.pierId)).toEqual(["p1"]);
  });
});

describe("riquadro e scala", () => {
  it("inquadra i posti con un margine, dentro la foto", () => {
    const berths = pier(["sx", "dx"], 6, "p1", { x: 700, y: 500 }, { x: 1000, y: 500 });
    const { walkways } = pierLayout(berths, PX);
    const b = drawingBounds(berths, walkways, PX, 2000, 1000);
    expect(b.x).toBeGreaterThan(0);
    expect(b.x + b.w).toBeLessThan(2000);
    expect(b.y).toBeLessThan(380);
    expect(b.y + b.h).toBeGreaterThan(620);
  });

  it("senza posti mostra tutta la foto", () => {
    expect(drawingBounds([], [], PX, 2000, 1000)).toEqual({ x: 0, y: 0, w: 2000, h: 1000 });
  });

  it("la barra della scala ha una misura tonda", () => {
    expect(scaleBarMeters(1000, 10)).toBe(20);
    expect(scaleBarMeters(3000, 2)).toBe(250);
  });
});
