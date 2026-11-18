// Bollettino di criticità della Protezione Civile: lettura delle zone (da un estratto dei file veri del 17/11/2026),
// zona del porto dal Comune, giorni validi e testo dell'avviso.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  civilAlertText,
  civilAlertWorthSending,
  currentDays,
  findZoneByComune,
  levelFromText,
  normalizePlace,
  zoneOutlook,
  zonesFromTopojson,
  type CivilBulletin,
} from "../src/lib/civil-protection";

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const today = zonesFromTopojson(read("dpc-today.json"));
const tomorrow = zonesFromTopojson(read("dpc-tomorrow.json"));
const bulletin: CivilBulletin = {
  name: "Bollettino del 17 novembre 2026 ore 15:19",
  issuedAt: "2026-11-17T14:42:35.375Z",
  days: [
    { date: "2026-11-17", zones: today },
    { date: "2026-11-18", zones: tomorrow },
  ],
};

describe("bollettino di criticità", () => {
  it("legge livelli e Comuni delle zone", () => {
    expect(levelFromText("Ordinaria / ALLERTA GIALLA")).toBe("gialla");
    expect(levelFromText("Moderata / ALLERTA ARANCIONE")).toBe("arancione");
    expect(levelFromText("Elevata / ALLERTA ROSSA")).toBe("rossa");
    expect(levelFromText("Assenza di fenomeni significativi prevedibili / NESSUNA ALLERTA")).toBe("verde");
    const serchio = today.find((z) => z.name === "Serchio-Lucca");
    expect(serchio?.levels).toEqual({ idrogeologico: "arancione", idraulico: "verde", temporali: "verde" });
    expect(today.find((z) => z.name === "Chiascio - Topino")?.levels.temporali).toBe("gialla");
  });

  it("trova la zona del porto dal Comune, anche scritto diversamente", () => {
    expect(normalizePlace("Sant'Egidio alla Vibrata")).toBe("sant egidio alla vibrata");
    expect(findZoneByComune(today, "giulianova")?.name).toBe("Bacini Tordino Vomano");
    expect(findZoneByComune(today, "Roseto degli Abruzzi")?.name).toBe("Bacini Tordino Vomano");
    expect(findZoneByComune(today, "Borgomare")).toBeNull();
    expect(findZoneByComune(today, null)).toBeNull();
  });

  it("usa solo i giorni da oggi in poi e scrive l'avviso", () => {
    expect(currentDays(bulletin, "2026-11-18").map((d) => d.date)).toEqual(["2026-11-18"]);
    const lucca = zoneOutlook(bulletin, "2026-11-17", "Serchio-Lucca");
    expect(lucca?.days[0]).toMatchObject({ date: "2026-11-17", max: "arancione" });
    expect(lucca?.days).toHaveLength(2);
    expect(civilAlertWorthSending(lucca)).toBe(true);
    const text = civilAlertText(lucca, "2026-11-17");
    expect(text?.title).toBe("Allerta arancione della Protezione Civile oggi");
    expect(text?.lines[1]).toBe("• oggi: allerta arancione per rischio idrogeologico.");

    const teramo = zoneOutlook(bulletin, "2026-11-17", "Bacini Tordino Vomano");
    expect(civilAlertWorthSending(teramo)).toBe(false);
    expect(civilAlertText(teramo, "2026-11-17")).toBeNull();
    expect(zoneOutlook(bulletin, "2026-11-20", "Serchio-Lucca")).toBeNull();
  });
});
