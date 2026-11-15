import { describe, expect, it } from "vitest";
import { berthSizePx, berthSlots, imageInfo, layoutPier, normalizeAngle, type PlanBerth } from "../src/lib/plan";

const berth = (id: string, side: "sx" | "dx", position: number, lengthCm = 1000, beamCm = 350): PlanBerth => ({ id, side, position, lengthCm, beamCm });

describe("disposizione dei posti lungo un pontile", () => {
  // Scala 10 px per metro, pontile largo 2 m, posti da 10 m: il centro dista (1 + 5) m = 60 px dall'asse.
  const berths = [berth("a1", "sx", 0), berth("a2", "dx", 0), berth("a3", "sx", 1), berth("a4", "dx", 1)];

  it("pontile orizzontale verso destra: sx sopra, dx sotto, posti verticali", () => {
    const placed = layoutPier(berths, { x: 100, y: 500 }, { x: 300, y: 500 }, 10);
    expect(placed).toEqual([
      { id: "a1", x: 150, y: 440, angle: 0 },
      { id: "a2", x: 150, y: 560, angle: 0 },
      { id: "a3", x: 250, y: 440, angle: 0 },
      { id: "a4", x: 250, y: 560, angle: 0 },
    ]);
  });

  it("pontile verticale verso l'alto: sx a sinistra, posti orizzontali", () => {
    const placed = layoutPier([berth("t1", "sx", 0), berth("t2", "sx", 1)], { x: 800, y: 600 }, { x: 800, y: 400 }, 10);
    expect(placed.map((p) => [p.x, p.y, p.angle])).toEqual([
      [740, 550, -90],
      [740, 450, -90],
    ]);
  });

  it("tracciando il pontile al contrario i lati si scambiano", () => {
    const [first] = layoutPier(berths, { x: 300, y: 500 }, { x: 100, y: 500 }, 10);
    expect(first.y).toBe(560); // ora "sx" è sotto
    expect(first.x).toBe(250); // e la posizione 0 parte dall'altro capo
  });

  it("posti più lunghi stanno più lontani dall'asse del pontile", () => {
    const [short, long] = layoutPier([berth("s", "sx", 0, 600), berth("l", "sx", 1, 1500)], { x: 0, y: 500 }, { x: 200, y: 500 }, 10);
    expect(500 - short.y).toBe(40); // 1 m + 3 m
    expect(500 - long.y).toBe(85); // 1 m + 7,5 m
  });

  it("senza scala o senza linea non dispone nulla", () => {
    expect(layoutPier(berths, { x: 5, y: 5 }, { x: 5, y: 5 }, 10)).toEqual([]);
    expect(layoutPier(berths, { x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toEqual([]);
  });
});

describe("misure e angoli", () => {
  it("dimensioni in pixel secondo la scala", () => {
    expect(berthSizePx({ lengthCm: 1200, beamCm: 400 }, 8)).toEqual({ w: 32, l: 96 });
  });
  it("normalizza gli angoli", () => {
    expect(normalizeAngle(270)).toBe(-90);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(-180)).toBe(180);
  });
});

describe("riconoscimento dell'immagine caricata", () => {
  it("legge le dimensioni di un PNG", () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x07, 0xd0, 0, 0, 0x05, 0x78]);
    expect(imageInfo(png)).toEqual({ mime: "image/png", width: 2000, height: 1400 });
  });

  it("legge le dimensioni di un JPEG, saltando i segmenti che precedono l'intestazione", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, // inizio immagine
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // segmento APP0 di 4 byte
      0xff, 0xc2, 0x00, 0x11, 0x08, 0x05, 0x78, 0x07, 0xd0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, // SOF2: 1400 × 2000
    ]);
    expect(imageInfo(jpeg)).toEqual({ mime: "image/jpeg", width: 2000, height: 1400 });
  });

  it("rifiuta ciò che non è un'immagine", () => {
    expect(imageInfo(new TextEncoder().encode("<svg onload=alert(1)></svg>"))).toBeNull();
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(imageInfo(new Uint8Array(0))).toBeNull();
  });
});

describe("lati invertiti", () => {
  it("con flip i posti passano dall'altra parte della linea, nello stesso ordine", () => {
    const berths = [berth("q1", "sx", 0), berth("q2", "sx", 1)];
    const normal = layoutPier(berths, { x: 100, y: 500 }, { x: 300, y: 500 }, 10);
    const flipped = layoutPier(berths, { x: 100, y: 500 }, { x: 300, y: 500 }, 10, 2, true);
    expect(normal.map((p) => p.y)).toEqual([440, 440]);
    expect(flipped.map((p) => p.y)).toEqual([560, 560]);
    expect(flipped.map((p) => p.x)).toEqual(normal.map((p) => p.x));
  });

  it("una banchina con larghezza 0 mette la poppa sulla linea tracciata", () => {
    const [q] = layoutPier([berth("q", "sx", 0, 800)], { x: 0, y: 500 }, { x: 100, y: 500 }, 10, 0);
    expect(500 - q.y).toBe(40); // metà della lunghezza del posto: 4 m × 10 px
  });
});

describe("posti creati in blocco", () => {
  it("alternati: uno di fronte all'altro", () => {
    expect(berthSlots("alternati", 4, 0, 0)).toEqual([
      { side: "sx", position: 0 },
      { side: "dx", position: 0 },
      { side: "sx", position: 1 },
      { side: "dx", position: 1 },
    ]);
  });

  it("lati con numeri diversi di posti: ogni lato parte dalla radice", () => {
    // 3 posti a sinistra, poi 2 a destra: quelli di destra stanno di fronte ai primi due, non dopo.
    const sx = berthSlots("sx", 3, 0, 0);
    const dx = berthSlots("dx", 2, 3, 0);
    expect(sx.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(dx).toEqual([
      { side: "dx", position: 0 },
      { side: "dx", position: 1 },
    ]);
  });

  it("aggiungendo posti a un lato si prosegue dopo gli ultimi di quel lato", () => {
    expect(berthSlots("dx", 2, 7, 4).map((s) => s.position)).toEqual([4, 5]);
    expect(berthSlots("alternati", 2, 7, 4)).toEqual([
      { side: "sx", position: 7 },
      { side: "dx", position: 7 },
    ]);
  });
});
