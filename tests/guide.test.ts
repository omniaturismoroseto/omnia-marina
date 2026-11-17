import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE, guideFor } from "../src/lib/guide";

const APP = join(__dirname, "../src/app/(app)");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? pages(path) : name === "page.tsx" ? [path] : [];
  });
}

describe("guida", () => {
  it("sezioni con ancore uniche", () => {
    const ids = GUIDE.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ogni collegamento «Guida» delle pagine porta a una sezione esistente", () => {
    const ids = new Set(GUIDE.map((s) => s.id));
    const used = pages(APP).flatMap((p) => [...readFileSync(p, "utf8").matchAll(/<PageHeader help="([^"]+)"/g)].map((m) => m[1]));
    expect(used.length).toBeGreaterThan(10);
    for (const id of used) expect(ids, id).toContain(id);
  });

  it("i collegamenti delle sezioni portano a pagine dell'app", () => {
    for (const s of GUIDE) {
      if (!s.link) continue;
      expect(existsSync(join(APP, s.link.href, "page.tsx")), s.link.href).toBe(true);
    }
  });

  it("l'operatore di banchina vede solo le sue sezioni", () => {
    const ids = guideFor("banchina").map((s) => s.id);
    expect(ids).toContain("banchina");
    expect(ids).not.toContain("contabilita");
    expect(ids).not.toContain("impostazioni");
    expect(guideFor("admin")).toHaveLength(GUIDE.length);
  });
});
