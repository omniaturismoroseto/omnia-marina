import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { drawingOrder, extendBounds, surroundingsToFeatures } from "../src/lib/plan-features";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/plan-surroundings.json", import.meta.url), "utf8"));

describe("sfondo della mappa", () => {
  it("le proposte di Claude diventano forme e servizi in pixel della foto", () => {
    const features = surroundingsToFeatures(fixture, 2000, 1400);
    const buildings = features.filter((f) => f.kind === "edificio");
    // Il poligono degenere viene scartato.
    expect(buildings).toHaveLength(3);
    expect(buildings[0].points[0]).toEqual({ x: 28, y: 19.6 });
    expect(buildings[0].name).toBe("Capitaneria");
    expect(buildings[1].name).toBeNull();
    // Il servizio con le coordinate fuori dalla foto resta sul bordo.
    const bar = features.find((f) => f.service === "bar")!;
    expect(bar.points).toEqual([{ x: 2000, y: 84 }]);
    expect(features.every((f) => f.source === "claude")).toBe(true);
  });

  it("servizi di tipo sconosciuto vengono ignorati", () => {
    const features = surroundingsToFeatures({ buildings: [], green: [], services: [{ type: "casinò", name: "", at: { x: 1, y: 1 } }] }, 100, 100);
    expect(features).toHaveLength(0);
  });

  it("ordine di disegno: terra e acqua come create, poi verde, edifici, servizi", () => {
    const order = drawingOrder([{ kind: "servizio" }, { kind: "edificio" }, { kind: "acqua" }, { kind: "verde" }, { kind: "terra" }] as const);
    expect(order.map((f) => f.kind)).toEqual(["acqua", "terra", "verde", "edificio", "servizio"]);
  });

  it("lo schema si allarga allo sfondo senza uscire dalla foto", () => {
    const b = extendBounds({ x: 100, y: 100, width: 200, height: 200 }, [{ points: [{ x: -50, y: 20 }, { x: 900, y: 250 }] }], 800, 600);
    expect(b).toEqual({ x: 0, y: 20, width: 800, height: 280 });
  });
});
