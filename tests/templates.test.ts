import { describe, expect, it } from "vitest";
import { textSections } from "../src/lib/templates";

describe("textSections", () => {
  it("separa le sezioni e riconosce i titoli numerati", () => {
    const text = "INFORMATIVA\r\nai sensi del GDPR\r\n\r\n1. Titolare\r\nIl Titolare è X.\r\n\r\n\r\n2) Dati\r\nRiga a\r\nRiga b\n\nNota finale";
    expect(textSections(text)).toEqual([
      { heading: null, lines: ["INFORMATIVA", "ai sensi del GDPR"] },
      { heading: "1. Titolare", lines: ["Il Titolare è X."] },
      { heading: "2) Dati", lines: ["Riga a", "Riga b"] },
      { heading: null, lines: ["Nota finale"] },
    ]);
  });

  it("non scambia per titolo un numero senza testo o un importo", () => {
    expect(textSections("2026\n\n1.000 euro di cauzione")[0].heading).toBeNull();
    expect(textSections("1.000 euro di cauzione")[0].heading).toBeNull();
  });
});
