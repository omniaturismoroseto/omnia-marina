import { describe, expect, it } from "vitest";
import { assignModules, type ModuleBerth } from "@/lib/plan-modules";

// Posti larghi 40 px e lunghi 100 px, 10 px per metro: sono dello stesso modulo entro 130 px (100 + 3 m).
const b = (id: string, x: number, module: number | null = null, unit = "A"): ModuleBerth => ({ id, unit, x, y: 0, l: 100, w: 40, module });

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
});
