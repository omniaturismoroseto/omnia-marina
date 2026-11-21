import { describe, expect, it } from "vitest";
import { baseMatchesPhoto } from "../src/lib/plan-base";

describe("base disegnata", () => {
  const photo = { width: 2000, height: 1400 };
  it("vale la stessa inquadratura a qualunque risoluzione", () => {
    expect(baseMatchesPhoto({ width: 2000, height: 1400 }, photo)).toBe(true);
    expect(baseMatchesPhoto({ width: 4000, height: 2800 }, photo)).toBe(true);
    // Un pixel di arrotondamento nell'esportazione non conta.
    expect(baseMatchesPhoto({ width: 3001, height: 2100 }, photo)).toBe(true);
  });
  it("una base ritagliata o con altre proporzioni non va", () => {
    expect(baseMatchesPhoto({ width: 1000, height: 800 }, photo)).toBe(false);
    expect(baseMatchesPhoto({ width: 2000, height: 1300 }, photo)).toBe(false);
  });
});
