import { describe, expect, it } from "vitest";
import { assignModules, type ModuleBerth } from "@/lib/plan-modules";

// Posti larghi 40 px e lunghi 100 px, 10 px per metro, a 0° (pontile orizzontale, posti verticali): affiancati entro 55 px.
const b = (id: string, x: number, module: number | null = null, unit = "A", y = 0, angle = 0): ModuleBerth => ({ id, unit, x, y, angle, l: 100, w: 40, module });

describe("moduli della pianta", () => {
  it("riconosce i pezzi staccati di un pontile", () => {
    const out = assignModules([b("a1", 0), b("a2", 45), b("a3", 90), b("b1", 600), b("b2", 645)], 10);
    expect(Object.fromEntries(out)).toEqual({ a1: 1, a2: 1, a3: 1, b1: 2, b2: 2 });
  });

  it("i moduli già riconosciuti restano separati anche se vicini", () => {
    // Il secondo modulo è stato avvicinato al primo: restano 1 e 2.
    const out = assignModules([b("a1", 0, 1), b("a2", 45, 1), b("b1", 95, 2), b("b2", 140, 2)], 10);
    expect(Object.fromEntries(out)).toEqual({ a1: 1, a2: 1, b1: 2, b2: 2 });
  });

  it("un posto nuovo vicino a un modulo ci entra, uno lontano ne fa uno nuovo; i moduli non passano da un tratto all'altro", () => {
    const out = assignModules([b("a1", 0, 1), b("a2", 45, 1), b("n1", 90), b("far", 900), b("t1", 135, null, "tratto")], 10);
    expect(Object.fromEntries(out)).toEqual({ a1: 1, a2: 1, n1: 1, far: 2, t1: 1 });
  });

  it("due file vicine ma sfalsate restano moduli diversi; i due lati di una passerella sono lo stesso modulo", () => {
    const out = assignModules(
      [
        b("a1", 0), b("a2", 45), b("a3", 90),
        // fila accanto, spostata di traverso di 60 px (più di un terzo del posto): un altro modulo
        b("s1", 135, null, "A", 60), b("s2", 180, null, "A", 60),
        // di fronte ad a1–a3, oltre una passerella di 2 m (centri a 100 + 20 px): stesso modulo
        b("f1", 0, null, "A", 120), b("f2", 45, null, "A", 120),
        // orientato in un altro modo: non si unisce
        b("x1", 0, null, "A", -60, 90),
      ],
      10,
    );
    const m = Object.fromEntries(out);
    expect(m.a1).toBe(m.a3);
    expect(m.f1).toBe(m.a1);
    expect(m.s1).toBe(m.s2);
    expect(m.s1).not.toBe(m.a1);
    expect(m.x1).not.toBe(m.a1);
  });
});
