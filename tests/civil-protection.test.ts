// Bollettino di criticità della Protezione Civile: lettura delle zone (da un estratto dei file veri del 17/11/2026),
// zona del porto dal Comune, giorni validi e testo dell'avviso.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bulletinSection,
  civilAlertText,
  civilAlertWorthSending,
  currentDays,
  distanceKm,
  findZoneByComune,
  levelFromText,
  nearbyPhenomena,
  normalizePlace,
  phenomenaFromTopojson,
  portVigilance,
  vigilanceAlertText,
  vigilanceWorthSending,
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

describe("bollettino di vigilanza (estratto vero del 18/11/2026, Liguria e Alta Toscana)", () => {
  const points = phenomenaFromTopojson(read("dpc-vigilanza-fenomeni-oggi.json"));
  const index = read("dpc-vigilanza-indice.json") as { html: string };
  const GENOVA = { lat: 44.405, lon: 8.93 };
  const PESCARA = { lat: 42.465, lon: 14.215 };

  it("trova burrasca e mare agitato vicino a Genova, niente a Pescara", () => {
    const near = nearbyPhenomena(points, GENOVA.lat, GENOVA.lon);
    expect(near.filter((p) => p.severe).map((p) => p.label)).toEqual(["Mare agitato o molto agitato", "Burrasca"]);
    expect(near.find((p) => p.code === 11)?.km).toBe(23);
    expect(nearbyPhenomena(points, PESCARA.lat, PESCARA.lon)).toEqual([]);
    expect(Math.round(distanceKm(GENOVA.lat, GENOVA.lon, PESCARA.lat, PESCARA.lon))).toBe(478);
  });

  it("estrae i testi su venti e mari", () => {
    expect(bulletinSection(index.html, "Venti")).toMatch(/^di burrasca sud-occidentali/);
    expect(bulletinSection(index.html, "Mari")).toMatch(/^agitati il Mar Ligure/);
    expect(bulletinSection(index.html, "Nebbie")).toBe("");
  });

  it("prepara l'avviso solo per i fenomeni vicini", () => {
    const bulletin = { name: "Bollettino di Vigilanza Meteo del 18/11/2026", days: [{ date: "2026-11-18", points, windText: "", seaText: "" }] };
    const genova = portVigilance(bulletin, "2026-11-18", GENOVA.lat, GENOVA.lon);
    expect(vigilanceWorthSending(genova)).toBe(true);
    const text = vigilanceAlertText(genova, "2026-11-18");
    expect(text?.title).toBe("Avviso di burrasca e mare agitato o molto agitato");
    expect(text?.lines[1]).toContain("• oggi: mare agitato o molto agitato, burrasca");
    expect(vigilanceWorthSending(portVigilance(bulletin, "2026-11-18", PESCARA.lat, PESCARA.lon))).toBe(false);
    expect(portVigilance(bulletin, "2026-11-18", null, null)[0].nearby).toEqual([]);
    expect(portVigilance(bulletin, "2026-11-19", GENOVA.lat, GENOVA.lon)).toEqual([]);
  });
});
