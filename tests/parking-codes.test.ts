import { describe, expect, it } from "vitest";
import { nextParkingCode } from "../src/lib/parking-codes";

describe("codice del posto auto aggiunto in fila", () => {
  it("prosegue la numerazione e salta i codici già usati", () => {
    expect(nextParkingCode("P32", new Set(["P32"]))).toBe("P33");
    expect(nextParkingCode("P32", new Set(["P32", "P33", "P34"]))).toBe("P35");
    expect(nextParkingCode("PC9", new Set())).toBe("PC10");
    expect(nextParkingCode("Box", new Set())).toBe("Box1");
  });
});
