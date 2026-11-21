import { describe, expect, it } from "vitest";
import { itemKindFromName } from "../src/lib/contract-items";

describe("voce del contratto dal nome del servizio", () => {
  it("riconosce posti auto, carrello e spazio a terra", () => {
    expect(itemKindFromName("Posto auto coperto")).toBe("auto_coperto");
    expect(itemKindFromName("Posto auto scoperto estivo")).toBe("auto_scoperto");
    expect(itemKindFromName("Carrelli / invasi")).toBe("carrello");
    expect(itemKindFromName("Sosta a terra")).toBe("secca");
  });

  it("tutto il resto è un servizio con il suo nome", () => {
    expect(itemKindFromName("Cauzione pass cancello")).toBeNull();
    expect(itemKindFromName("Cauzione posto auto")).toBeNull();
    expect(itemKindFromName("Corrente elettrica")).toBeNull();
    expect(itemKindFromName("Posto auto")).toBeNull();
  });
});
