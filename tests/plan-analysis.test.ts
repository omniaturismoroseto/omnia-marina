import { describe, expect, it } from "vitest";
import { categoryForLength, estimateScale, planBerths, sideOf, suggestCodes, toProposals, type AiAnalysis } from "../src/lib/plan-analysis";

const W = 2000;
const H = 1000;

const structure = (over: Partial<AiAnalysis["structures"][number]> = {}): AiAnalysis["structures"][number] => ({
  name: "Pontile centrale",
  kind: "pontile",
  start: { x: 100, y: 500 }, // (200, 500) px
  end: { x: 300, y: 500 }, // (600, 500) px: pontile orizzontale verso destra
  length_m: 40,
  sides: [
    { boats_point: { x: 200, y: 450 }, berths: 12, boat_length_m: 8 }, // sopra: sinistra di chi va verso destra
    { boats_point: { x: 200, y: 560 }, berths: 10, boat_length_m: 9.5 }, // sotto: destra
  ],
  ...over,
});

describe("lato delle barche rispetto alla linea", () => {
  it("sopra una linea verso destra è sinistra, sotto è destra", () => {
    expect(sideOf({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -3 })).toBe("sx");
    expect(sideOf({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 })).toBe("dx");
  });
  it("su una linea verso l'alto, a sinistra dello schermo è sinistra", () => {
    expect(sideOf({ x: 0, y: 10 }, { x: 0, y: 0 }, { x: -2, y: 5 })).toBe("sx");
  });
});

describe("dalla risposta del modello alle proposte", () => {
  it("converte i millesimi in pixel e assegna i lati", () => {
    const [p] = toProposals({ structures: [structure()], notes: "" }, W, H);
    expect(p.a).toEqual({ x: 200, y: 500 });
    expect(p.b).toEqual({ x: 600, y: 500 });
    expect(p.sides).toEqual([
      { side: "sx", count: 12, boatLengthCm: 800 },
      { side: "dx", count: 10, boatLengthCm: 950 },
    ]);
  });

  it("scarta segmenti degeneri e strutture senza posti", () => {
    const out = toProposals(
      {
        structures: [
          structure({ end: { x: 101, y: 500 } }), // 2 px: troppo corto
          structure({ sides: [{ boats_point: { x: 200, y: 450 }, berths: 0, boat_length_m: 8 }] }),
        ],
        notes: "",
      },
      W,
      H,
    );
    expect(out).toEqual([]);
  });

  it("corregge valori fuori scala e tiene un solo lato per parte", () => {
    const [p] = toProposals(
      {
        structures: [
          structure({
            start: { x: -50, y: 500 },
            end: { x: 1200, y: 500 },
            sides: [
              { boats_point: { x: 200, y: 450 }, berths: 5, boat_length_m: 8 },
              { boats_point: { x: 600, y: 440 }, berths: 9999, boat_length_m: 1 },
            ],
          }),
        ],
        notes: "",
      },
      W,
      H,
    );
    expect(p.a.x).toBe(0);
    expect(p.b.x).toBe(2000);
    expect(p.sides).toEqual([{ side: "sx", count: 150, boatLengthCm: 300 }]);
  });
});

describe("scala stimata", () => {
  it("mediana dei rapporti pixel/metri delle strutture lunghe", () => {
    const proposals = toProposals(
      {
        structures: [
          structure({ length_m: 40 }), // 400 px / 40 m = 10
          structure({ length_m: 50 }), // 8
          structure({ length_m: 5 }), // troppo corta: ignorata
        ],
        notes: "",
      },
      W,
      H,
    );
    expect(estimateScale(proposals)).toBe(9);
    expect(estimateScale([])).toBeNull();
  });
});

describe("sigle e categorie", () => {
  it("propone le sigle libere in ordine", () => {
    expect(suggestCodes(3, ["A", "c"])).toEqual(["B", "D", "E"]);
    expect(suggestCodes(2, Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)))).toEqual(["AA", "AB"]);
  });
  it("sceglie la categoria più piccola in cui sta la barca", () => {
    const cats = [
      { id: "iii", maxLengthCm: 1000 },
      { id: "i", maxLengthCm: 600 },
      { id: "ii", maxLengthCm: 800 },
    ];
    expect(categoryForLength(cats, 750)?.id).toBe("ii");
    expect(categoryForLength(cats, 1400)?.id).toBe("iii");
    expect(categoryForLength([], 700)).toBeNull();
  });
});

describe("posti di una struttura confermata", () => {
  it("numera prima il lato sinistro poi il destro, entrambi dalla radice, già disposti", () => {
    const berths = planBerths(
      "C",
      "pontile",
      { x: 0, y: 500 },
      { x: 300, y: 500 },
      [
        { side: "dx", count: 2, lengthCm: 1000, beamCm: 350 },
        { side: "sx", count: 3, lengthCm: 1000, beamCm: 350 },
      ],
      10,
    );
    expect(berths.map((b) => `${b.code}:${b.side}${b.position}`)).toEqual(["C1:sx0", "C2:sx1", "C3:sx2", "C4:dx0", "C5:dx1"]);
    // pontile largo 2 m: centro dei posti a (1 + 5) m = 60 px dall'asse
    expect(berths[0].placement).toEqual({ id: "C1", x: 50, y: 440, angle: 0 });
    expect(berths[3].placement).toEqual({ id: "C4", x: 50, y: 560, angle: 0 });
  });
  it("una banchina mette le poppe sulla linea", () => {
    const [b] = planBerths("Q", "banchina", { x: 0, y: 500 }, { x: 100, y: 500 }, [{ side: "sx", count: 1, lengthCm: 800, beamCm: 300 }], 10);
    expect(500 - b.placement.y).toBe(40);
  });
});
