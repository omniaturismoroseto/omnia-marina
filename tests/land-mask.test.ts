import { describe, expect, it } from "vitest";
import { landContours, landMask, pointInRing } from "../src/lib/land-mask";

// Immagine finta 60 × 40: mare blu, terra grigio-sabbia a sinistra (x < 20) con un laghetto, una barca bianca in mare.
function image() {
  const w = 60;
  const h = 40;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number, c: [number, number, number]) => rgba.set([...c, 255], (y * w + x) * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const land = x < 20;
      const pond = x >= 6 && x < 12 && y >= 15 && y < 22;
      const boat = x >= 40 && x < 43 && y >= 10 && y < 13;
      // Un po' di variazione nell'acqua, come in una foto vera.
      const sea: [number, number, number] = [30 + ((x * 7 + y * 3) % 12), 90 + ((x + y) % 10), 140 + ((x * 3) % 14)];
      set(x, y, boat ? [245, 245, 240] : pond ? sea : land ? [190, 180, 160] : sea);
    }
  }
  return { rgba, w, h };
}

describe("terra e acqua dai colori della foto", () => {
  const { rgba, w, h } = image();
  const mask = landMask(rgba, w, h, { seeds: [{ x: 50, y: 30 }, { x: 30, y: 5 }], minLandCells: 20, minHoleCells: 4 });
  const at = (x: number, y: number) => mask[y * w + x];

  it("la terra a sinistra resta terra, il mare resta acqua", () => {
    expect(at(3, 3)).toBe(1);
    expect(at(15, 35)).toBe(1);
    expect(at(30, 20)).toBe(0);
    expect(at(55, 38)).toBe(0);
  });

  it("una barca isolata in mare non diventa terra", () => {
    expect(at(41, 11)).toBe(0);
  });

  it("un laghetto chiuso nella terra non è collegato al mare: resta terra", () => {
    expect(at(8, 18)).toBe(1);
  });

  it("le celle forzate (posti barca) sono acqua anche se bianche", () => {
    const forced = new Uint8Array(w * h);
    for (let y = 10; y < 13; y++) for (let x = 40; x < 43; x++) forced[y * w + x] = 1;
    const m = landMask(rgba, w, h, { seeds: [{ x: 50, y: 30 }], forcedWater: forced, minLandCells: 1 });
    expect(m[11 * w + 41]).toBe(0);
  });

  it("i contorni racchiudono la terra; un buco d'acqua è segnato come buco", () => {
    const rings = landContours(mask, w, h);
    expect(rings.length).toBeGreaterThan(0);
    const outer = rings[0];
    expect(outer.land).toBe(true);
    expect(pointInRing({ x: 5, y: 5 }, outer.points)).toBe(true);
    expect(pointInRing({ x: 40, y: 20 }, outer.points)).toBe(false);

    // Terra con un buco: anello esterno di terra e anello interno d'acqua.
    const mw = 20;
    const mh = 20;
    const m = new Uint8Array(mw * mh);
    for (let y = 2; y < 18; y++) for (let x = 2; x < 18; x++) m[y * mw + x] = x >= 7 && x < 13 && y >= 7 && y < 13 ? 0 : 1;
    const r = landContours(m, mw, mh, 0.5, 1);
    expect(r).toHaveLength(2);
    expect(r[0].land).toBe(true);
    expect(r[1].land).toBe(false);
    expect(pointInRing({ x: 10, y: 10 }, r[1].points)).toBe(true);
  });
});

describe("chiusura delle tacche", () => {
  it("una tacca stretta nella terra si riempie, un canale largo resta acqua", () => {
    const w = 40;
    const h = 20;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Terra in alto (y < 10) con una tacca larga 2 celle a x = 10 e un canale largo 10 celle da x = 25.
        const land = y < 10 && !(x >= 10 && x < 12 && y >= 6) && !(x >= 25 && x < 35);
        rgba.set([...(land ? [190, 180, 160] : [30, 90, 140]), 255], (y * w + x) * 4);
      }
    }
    const m = landMask(rgba, w, h, { seeds: [{ x: 20, y: 15 }], minLandCells: 1, minHoleCells: 1, closeCells: 2 });
    expect(m[8 * w + 10]).toBe(1);
    expect(m[5 * w + 30]).toBe(0);
  });
});
