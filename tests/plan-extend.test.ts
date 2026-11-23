import { describe, expect, it } from "vitest";
import { placeNewBerths, type PlacedBerth } from "@/lib/plan-extend";

// Scala 10 px/m; pontile da (0,100) a (200,100), largo 2 m: la sinistra di chi va verso destra è in alto (y minore).
// Un posto lungo 10 m ha il centro a 1 + 5 = 6 m dalla linea: y = 40 a sinistra, y = 160 a destra.
const M = 10;
const trace = { a: { x: 0, y: 100 }, b: { x: 200, y: 100 }, widthM: 2 };
const berth = (side: "sx" | "dx", position: number, x: number, y: number): PlacedBerth => ({ side, position, x, y, angle: 0, lengthCm: 1000, beamCm: 350 });
const existing = [berth("sx", 0, 20, 40), berth("sx", 1, 60, 40), berth("dx", 0, 20, 160)];
const nuovo = (id: string, side: "sx" | "dx", position: number, lengthCm = 1000) => ({ id, side, position, lengthCm, beamCm: 350 });

describe("posti nuovi sulla pianta", () => {
  it("proseguono dopo l'ultimo posto del lato, con la stessa distanza e lo stesso angolo", () => {
    const out = placeNewBerths(existing, [nuovo("s2", "sx", 2), nuovo("s3", "sx", 3), nuovo("d1", "dx", 1)], trace, M);
    expect(out).toEqual([
      { id: "s2", x: 100, y: 40, angle: 0 },
      { id: "s3", x: 140, y: 40, angle: 0 },
      { id: "d1", x: 60, y: 160, angle: 0 },
    ]);
  });

  it("un posto più lungo si allontana dal pontile della differenza", () => {
    const [p] = placeNewBerths(existing, [nuovo("s2", "sx", 2, 1200)], trace, M);
    expect(p).toMatchObject({ x: 100, y: 30 });
  });

  it("su un lato vuoto si mettono di fronte ai posti dell'altro lato", () => {
    const onlyLeft = existing.filter((b) => b.side === "sx");
    const out = placeNewBerths(onlyLeft, [nuovo("d0", "dx", 0), nuovo("d1", "dx", 1), nuovo("d2", "dx", 2)], trace, M);
    expect(out.map((p) => [p.id, p.x, p.y])).toEqual([
      ["d0", 20, 160],
      ["d1", 60, 160],
      ["d2", 100, 160],
    ]);
  });

  it("senza linea tracciata la direzione e la linea si ricavano dai posti", () => {
    const out = placeNewBerths(existing, [nuovo("s2", "sx", 2), nuovo("d1", "dx", 1)], null, M);
    expect(out).toEqual([
      { id: "s2", x: 100, y: 40, angle: 0 },
      { id: "d1", x: 60, y: 160, angle: 0 },
    ]);
  });

  it("senza linea, con barche di lunghezze diverse, la direzione viene dall'orientamento dei posti", () => {
    // Come un tratto vero: due posti da 12 m poi due da 15 m, che sporgono di più dal pontile.
    const mixed: PlacedBerth[] = [
      { side: "sx", position: 3, x: 448, y: 956, angle: 0, lengthCm: 1200, beamCm: 400 },
      { side: "dx", position: 3, x: 448, y: 1124, angle: 0, lengthCm: 1200, beamCm: 400 },
      { side: "sx", position: 4, x: 512, y: 938, angle: 0, lengthCm: 1500, beamCm: 480 },
      { side: "dx", position: 4, x: 512, y: 1142, angle: 0, lengthCm: 1500, beamCm: 480 },
      { side: "sx", position: 5, x: 578, y: 938, angle: 0, lengthCm: 1500, beamCm: 480 },
      { side: "dx", position: 5, x: 578, y: 1142, angle: 0, lengthCm: 1500, beamCm: 480 },
    ];
    const out = placeNewBerths(mixed, [nuovo("s6", "sx", 6, 1500), nuovo("d6", "dx", 6, 1500), nuovo("s7", "sx", 7, 1500)], null, M);
    const at = Object.fromEntries(out.map((p) => [p.id, p]));
    // Stessa riga dei posti da 15 m, a passo regolare.
    expect(at.s6.y).toBe(938);
    expect(at.d6.y).toBe(1142);
    expect(at.s7.y).toBe(938);
    expect(at.s6.x).toBeGreaterThan(640);
    expect(at.s6.x).toBeLessThan(648);
    expect(at.s7.x - at.s6.x).toBeCloseTo(at.s6.x - 578, 0);
  });

  it("con la sola linea si distribuiscono lungo il pontile; senza niente restano da disporre", () => {
    const out = placeNewBerths([], [nuovo("a", "sx", 4), nuovo("b", "dx", 5)], trace, M);
    expect(out.map((p) => [p.id, p.x, p.y])).toEqual([
      ["a", 100, 40],
      ["b", 100, 160],
    ]);
    expect(placeNewBerths([], [nuovo("a", "sx", 0)], null, M)).toEqual([]);
    expect(placeNewBerths(existing, [], trace, M)).toEqual([]);
  });
});

describe("tratto dei posti nuovi", () => {
  const sections = [{ id: "cn" }, { id: "cs" }, { id: "testata" }];
  const list = [
    { code: "CN12", sectionId: "cn" },
    { code: "CS14", sectionId: "cs" },
    { code: "C06", sectionId: null },
    { code: "C12", sectionId: "testata" },
  ];
  it("va dove sta il posto con la stessa sigla e il numero più alto", async () => {
    const { targetSection } = await import("@/lib/plan-extend");
    expect(targetSection(sections, list, "CN")?.id).toBe("cn");
    expect(targetSection(sections, list, "CS")?.id).toBe("cs");
    expect(targetSection(sections, list, "C")?.id).toBe("testata");
    expect(targetSection(sections, [{ code: "C06", sectionId: null }], "C")).toBeNull();
    expect(targetSection(sections, list, "Z")?.id).toBe("testata");
    expect(targetSection([], list, "CN")).toBeNull();
  });
});

describe("tratti: linea stimata e posizioni del pontile", () => {
  it("la linea mai tracciata si ricava dai posti, a metà tra i lati e lunga quanto i posti", async () => {
    const { estimateTrace } = await import("@/lib/plan-extend");
    const t = estimateTrace(existing, M)!;
    expect(t.a.y).toBe(100);
    expect(t.b.y).toBe(100);
    expect(t.a.x).toBeCloseTo(20 - 17.5, 0);
    expect(t.b.x).toBeCloseTo(60 + 17.5, 0);
    expect(estimateTrace([], M)).toBeNull();
  });

  it("i tratti si rinumerano uno dopo l'altro, senza sovrapporsi", async () => {
    const { renumberPier } = await import("@/lib/plan-extend");
    const out = renumberPier([
      [
        { id: "a1", side: "sx", position: 0 },
        { id: "a2", side: "dx", position: 0 },
        { id: "a3", side: "sx", position: 1 },
      ],
      [
        { id: "b1", side: "sx", position: 5 },
        { id: "b2", side: "dx", position: 5 },
      ],
    ]);
    expect(Object.fromEntries(out)).toEqual({ a1: 0, a2: 0, a3: 1, b1: 2, b2: 2 });
  });
});

describe("linea lunga quanto serve", () => {
  it("si allunga dalla testata se i posti non ci stanno, altrimenti resta", async () => {
    const { fitTrace } = await import("@/lib/plan-extend");
    const line = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, widthM: 2 };
    expect(fitTrace(line, 2, 40)).toBe(line);
    const longer = fitTrace(line, 4, 40);
    expect(longer.a).toEqual({ x: 0, y: 0 });
    expect(longer.b.x).toBeCloseTo(176, 0);
  });
});

describe("linea accorciata ai posti rimasti", () => {
  it("tiene direzione e traverso, va dal primo all'ultimo posto", async () => {
    const { clipTrace } = await import("@/lib/plan-extend");
    const line = { a: { x: 0, y: 100 }, b: { x: 300, y: 100 }, widthM: 2 };
    const out = clipTrace(line, [{ x: 60, y: 40, beamCm: 400 }, { x: 140, y: 160, beamCm: 400 }], M);
    expect(out).toEqual({ a: { x: 40, y: 100 }, b: { x: 160, y: 100 }, widthM: 2 });
    expect(clipTrace(line, [], M)).toBe(line);
  });
});
