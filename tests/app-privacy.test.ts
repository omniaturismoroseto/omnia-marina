import { describe, expect, it } from "vitest";
import { APP_PRIVACY_TEXT, appPrivacyVersion, privacyPending } from "@/lib/app-privacy";
import { fillTemplate, textSections } from "@/lib/templates";

describe("informativa dell'app", () => {
  it("chiede di accettare al primo accesso e dopo un cambio di versione del porto", () => {
    expect(privacyPending(null, "1.0")).toBe(true);
    expect(privacyPending(appPrivacyVersion("1.0"), "1.0")).toBe(false);
    expect(privacyPending(appPrivacyVersion("1.0"), "1.1")).toBe(true);
  });

  it("si compila con i dati del porto e si divide in sezioni numerate", () => {
    const text = fillTemplate(APP_PRIVACY_TEXT, {
      name: "Marina Scirocco",
      legalName: "Marina Scirocco S.r.l.",
      address: null,
      zip: null,
      city: null,
      province: null,
      email: "info@example.com",
      vatNumber: null,
    });
    expect(text).not.toMatch(/\{\{/);
    expect(text).toContain("Marina Scirocco S.r.l.");
    expect(text).toContain("info@example.com");
    expect(textSections(text).filter((s) => s.heading).map((s) => s.heading)).toHaveLength(5);
  });
});
