import { describe, expect, it } from "vitest";
import { moduleCodes, stripModules } from "@/lib/pier-strip";

const berth = (code: string, side: "sx" | "dx", position: number, module: number | null) => ({ id: code, code, side, position, module });

describe("stripModules", () => {
  it("divide i posti per modulo, in ordine di codice, con le colonne dalla radice del modulo", () => {
    const list = [
      berth("R12", "dx", 11, 2),
      berth("R13", "dx", 12, 2),
      berth("R1", "dx", 0, 1),
      berth("R2", "dx", 1, 1),
      berth("R23", "sx", 0, 1),
      berth("R24", "sx", 1, 1),
      berth("R34", "sx", 11, 2),
    ];
    const groups = stripModules(list);
    expect(groups.map((g) => g.module)).toEqual([1, 2]);
    expect(groups[1].columns.get("R12")).toBe(0);
    expect(groups[1].columns.get("R34")).toBe(0);
    expect(groups[1].span).toBe(2);
    expect(moduleCodes(groups[0].berths)).toBe("R23–R24 · R1–R2");
  });

  it("mette in fondo i posti non ancora sulla pianta", () => {
    const groups = stripModules([berth("A9", "sx", 8, null), berth("A1", "sx", 0, 3)]);
    expect(groups.map((g) => g.module)).toEqual([3, null]);
  });
});
