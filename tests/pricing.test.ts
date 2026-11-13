import { describe, expect, it } from "vitest";
import { categoryForBoat, occupiedUntil, quoteStay, seasonForDate, splitInstalments, type RateRow, type SeasonPeriod } from "../src/lib/pricing";
import { addMonths, diffDays } from "../src/lib/dates";
import { parseMeters, parseMoney, splitVat } from "../src/lib/format";

const periods: SeasonPeriod[] = [
  { season: "media", startDate: "2026-06-01", endDate: "2026-06-30" },
  { season: "alta", startDate: "2026-07-01", endDate: "2026-08-31" },
  { season: "media", startDate: "2026-09-01", endDate: "2026-09-30" },
];

const rate: RateRow = {
  dailyLow: 2000,
  dailyMid: 3500,
  dailyHigh: 5000,
  monthlyLow: 30000,
  monthlyMid: 60000,
  monthlyHigh: 90000,
  annual: 350000,
};

describe("stagioni", () => {
  it("fuori dai periodi è bassa stagione", () => {
    expect(seasonForDate(periods, "2026-03-15")).toBe("bassa");
    expect(seasonForDate(periods, "2026-06-30")).toBe("media");
    expect(seasonForDate(periods, "2026-07-01")).toBe("alta");
  });

  it("se due periodi si sovrappongono vince l'alta", () => {
    const overlapping: SeasonPeriod[] = [...periods, { season: "media", startDate: "2026-08-01", endDate: "2026-08-15" }];
    expect(seasonForDate(overlapping, "2026-08-10")).toBe("alta");
  });
});

describe("occupazione del posto", () => {
  it("transito: il giorno di partenza è già libero", () => {
    expect(occupiedUntil("transito", "2026-07-10", "2026-07-12")).toBe("2026-07-12");
  });
  it("transito in giornata: conta comunque una notte", () => {
    expect(occupiedUntil("transito", "2026-07-10", "2026-07-10")).toBe("2026-07-11");
  });
  it("contratto: l'ultimo giorno è occupato", () => {
    expect(occupiedUntil("annuale", "2026-01-01", "2026-12-31")).toBe("2027-01-01");
  });
});

describe("preventivo", () => {
  it("transito a cavallo di due stagioni", () => {
    // Notti del 29 e 30 giugno (media) + 1 e 2 luglio (alta).
    const q = quoteStay({ type: "transito", startDate: "2026-06-29", endDate: "2026-07-03", rate, periods });
    expect(q.totalCents).toBe(2 * 3500 + 2 * 5000);
    expect(q.lines.map((l) => l.quantity)).toEqual([2, 2]);
  });

  it("mensile: mesi interi più giorni residui", () => {
    // Giugno intero (media) + luglio intero (alta) + 10 giorni di agosto (alta).
    const q = quoteStay({ type: "mensile", startDate: "2026-06-01", endDate: "2026-08-10", rate, periods });
    expect(q.totalCents).toBe(60000 + 90000 + 10 * 5000);
  });

  it("stagionale di quattro mesi esatti", () => {
    const q = quoteStay({ type: "stagionale", startDate: "2026-06-01", endDate: "2026-09-30", rate, periods });
    expect(q.totalCents).toBe(60000 + 90000 + 90000 + 60000);
    expect(q.lines.every((l) => l.label.startsWith("Mes"))).toBe(true);
  });

  it("annuale: canone fisso", () => {
    const q = quoteStay({ type: "annuale", startDate: "2026-01-01", endDate: "2026-12-31", rate, periods });
    expect(q.totalCents).toBe(350000);
  });

  it("il totale è sempre la somma delle righe", () => {
    const q = quoteStay({ type: "mensile", startDate: "2026-01-31", endDate: "2026-04-15", rate, periods });
    expect(q.totalCents).toBe(q.lines.reduce((s, l) => s + l.amountCents, 0));
  });
});

describe("categoria tariffaria", () => {
  const categories = [
    { name: "I", maxLengthCm: 600, maxBeamCm: 250 },
    { name: "II", maxLengthCm: 800, maxBeamCm: 300 },
    { name: "III", maxLengthCm: 1000, maxBeamCm: 350 },
  ];
  it("sceglie la più piccola che contiene la barca", () => {
    expect(categoryForBoat(categories, { lengthCm: 750, beamCm: 280 })?.name).toBe("II");
  });
  it("una barca corta ma larga sale di categoria", () => {
    expect(categoryForBoat(categories, { lengthCm: 590, beamCm: 290 })?.name).toBe("II");
  });
  it("nessuna categoria se la barca è troppo grande", () => {
    expect(categoryForBoat(categories, { lengthCm: 1400, beamCm: 420 })).toBeNull();
  });
});

describe("rate", () => {
  it("la somma delle rate è il totale, il resto va sull'ultima", () => {
    const parts = splitInstalments(100000, 3, "2026-01-31", 1);
    expect(parts.map((p) => p.amountCents)).toEqual([33333, 33333, 33334]);
    expect(parts.map((p) => p.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});

describe("date e importi", () => {
  it("addMonths resta a fine mese", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 2)).toBe("2027-02-15");
  });
  it("diffDays", () => {
    expect(diffDays("2026-03-28", "2026-03-30")).toBe(2); // attraversa il cambio dell'ora
  });
  it("parseMoney accetta i formati italiani", () => {
    expect(parseMoney("1.234,56")).toBe(123456);
    expect(parseMoney("1234,5")).toBe(123450);
    expect(parseMoney("1234.56")).toBe(123456);
    expect(parseMoney("€ 12")).toBe(1200);
    expect(parseMoney("1.500")).toBe(150000);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
  it("parseMeters", () => {
    expect(parseMeters("9,5")).toBe(950);
    expect(parseMeters("12.35 m")).toBe(1235);
    expect(parseMeters("x")).toBeNull();
  });
  it("scorporo IVA", () => {
    expect(splitVat(12200, 22)).toEqual({ netCents: 10000, vatCents: 2200 });
    const s = splitVat(9999, 22);
    expect(s.netCents + s.vatCents).toBe(9999);
  });
});
