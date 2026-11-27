import { describe, expect, it } from "vitest";
import { CONTRACT_PARTS, contractPart, customContractTexts } from "../src/lib/contract-texts";

describe("testo del contratto personalizzabile", () => {
  it("senza testi del porto usa il predefinito e riempie i campi", () => {
    expect(contractPart({}, "verb")).toBe("cede in locazione");
    const lessor = contractPart(null, "lessor", { locatore: "Marina Srl", sede: " con sede in Roseto", piva: ", P. IVA 123", porto: "Marina" });
    expect(lessor.startsWith("la Società Marina Srl con sede in Roseto, P. IVA 123, in persona")).toBe(true);
    expect(lessor).toContain("“Marina”");
  });

  it("il testo del porto prende il posto del predefinito; un campo sconosciuto resta com'è", () => {
    expect(contractPart({ title: "Contratto di ormeggio {anno}" }, "title", { porto: "X" })).toBe("Contratto di ormeggio {anno}");
    expect(contractPart({ art2: "IVA al {iva}% da pagare {pagamento}." }, "art2", { iva: "22", pagamento: "subito" })).toBe("IVA al 22% da pagare subito.");
  });

  it("si salvano solo i testi cambiati, senza spazi in più", () => {
    const def = CONTRACT_PARTS.find((p) => p.key === "verb")!.text;
    expect(customContractTexts({ verb: def, title: "  Contratto di ormeggio \r\n", art1: "", signTenant: undefined })).toEqual({ title: "Contratto di ormeggio" });
  });
});
