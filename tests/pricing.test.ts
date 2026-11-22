import { describe, expect, it } from "vitest";
import { categoryForBoat, occupiedUntil, quoteStay, seasonForDate, splitInstalments, annualTotal, grossQuote, lowSeasonRanges, groupPiersByName, pierRate, ratePierId, withVat, type RateRow, type SeasonPeriod } from "../src/lib/pricing";
import { addMonths, annualEnd, diffDays, yearPeriod } from "../src/lib/dates";
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
  seasonal: 0,
  waste: 0,
  service: 0,
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

  it("la quota rifiuti non entra nel canone: è una voce a parte del contratto", () => {
    const q = quoteStay({ type: "annuale", startDate: "2026-01-01", endDate: "2026-12-31", rate: { ...rate, waste: 4000 }, periods });
    expect(q.lines.map((l) => l.label)).toEqual(["Canone annuale"]);
    expect(q.totalCents).toBe(350000);
  });

  it("stagionale con canone fisso: il canone, qualunque sia il periodo", () => {
    const q = quoteStay({ type: "stagionale", startDate: "2026-05-01", endDate: "2026-09-30", rate: { ...rate, seasonal: 90000 }, periods });
    expect(q.lines).toEqual([{ label: "Canone stagionale", quantity: 1, unitCents: 90000, amountCents: 90000 }]);
  });

  it("il totale è sempre la somma delle righe", () => {
    const q = quoteStay({ type: "mensile", startDate: "2026-01-31", endDate: "2026-04-15", rate, periods });
    expect(q.totalCents).toBe(q.lines.reduce((s, l) => s + l.amountCents, 0));
  });
});

describe("tariffa del pontile", () => {
  const zero = { dailyLow: 0, dailyMid: 0, dailyHigh: 0, monthlyLow: 0, monthlyMid: 0, monthlyHigh: 0, annual: 0, seasonal: 0, waste: 0, service: 0 };
  const base = { ...rate, waste: 4000, pierId: null };
  // Come a Portorose: nella darsena C il canone annuale costa di più, transiti e mensili restano quelli base.
  const darsenaC = { ...zero, annual: 171000, pierId: "pontile-c" };

  it("senza pontile vale la tariffa base", () => {
    expect(pierRate([base, darsenaC], null)).toEqual({ ...rate, waste: 4000 });
  });

  it("nel pontile gli importi compilati sostituiscono quelli base, gli altri restano", () => {
    const r = pierRate([base, darsenaC], "pontile-c")!;
    expect(r.annual).toBe(171000);
    expect(r.dailyHigh).toBe(rate.dailyHigh);
    expect(r.waste).toBe(4000);
    expect(quoteStay({ type: "annuale", startDate: "2026-01-01", endDate: "2026-12-31", rate: r, periods }).totalCents).toBe(171000);
  });

  it("un pontile senza righe proprie usa la tariffa base", () => {
    expect(pierRate([base], "pontile-c")?.annual).toBe(rate.annual);
  });

  it("solo la riga del pontile: le caselle vuote restano a zero", () => {
    expect(pierRate([darsenaC], "pontile-c")?.dailyLow).toBe(0);
  });

  it("nessuna riga: nessuna tariffa", () => {
    expect(pierRate([], "pontile-c")).toBeNull();
    expect(pierRate([darsenaC], null)).toBeNull();
  });

  it("i pontili con lo stesso nome sono una scheda sola, nell'ordine di arrivo", () => {
    const groups = groupPiersByName([
      { id: "1", name: "Darsena C", baseRate: false },
      { id: "2", name: "Pontile A", baseRate: true },
      { id: "3", name: " darsena  c ", baseRate: true },
    ]);
    expect(groups.map((g) => [g.name, g.ids])).toEqual([
      ["Darsena C", ["1", "3"]],
      ["Pontile A", ["2"]],
    ]);
    // La tariffa base risulta accesa solo se tutti i pontili del gruppo la usano.
    expect(groups.map((g) => g.baseRate)).toEqual([false, true]);
  });

  it("un pontile con la tariffa base accesa non legge i suoi prezzi", () => {
    expect(ratePierId({ id: "pontile-c", baseRate: true })).toBeNull();
    expect(ratePierId({ id: "pontile-c", baseRate: false })).toBe("pontile-c");
    expect(ratePierId(null)).toBeNull();
  });
});

describe("bassa stagione", () => {
  it("è il resto del listino, fuori dai periodi di media e alta", () => {
    const p: SeasonPeriod[] = [
      { season: "alta", startDate: "2026-07-01", endDate: "2026-08-31" },
      { season: "media", startDate: "2026-09-01", endDate: "2026-09-30" },
    ];
    expect(lowSeasonRanges(p, "2026-01-01", "2026-12-31")).toEqual([
      { startDate: "2026-01-01", endDate: "2026-06-30" },
      { startDate: "2026-10-01", endDate: "2026-12-31" },
    ]);
    expect(lowSeasonRanges([], "2026-01-01", "2026-12-31")).toEqual([{ startDate: "2026-01-01", endDate: "2026-12-31" }]);
  });
});

describe("IVA e totale annuo", () => {
  it("prezzi senza IVA: l'IVA si aggiunge", () => {
    expect(withVat(100000, 22, false)).toBe(122000);
    expect(withVat(100000, 22, true)).toBe(100000);
    // Annuale 1.500 + rifiuti 40 + condominio 160 = 1.700 netti, IVA 374, totale 2.074.
    expect(annualTotal({ annual: 150000, waste: 4000, service: 16000 }, 22, false)).toEqual({ netCents: 170000, vatCents: 37400, totalCents: 207400 });
  });

  it("prezzi IVA inclusa: l'IVA è già dentro il totale", () => {
    expect(annualTotal({ annual: 183000, waste: 4880, service: 19520 }, 22, true)).toEqual({ netCents: 170000, vatCents: 37400, totalCents: 207400 });
  });

  it("il preventivo dei contratti esce IVA compresa, con rifiuti e condominio solo per gli annuali", () => {
    const r = { ...rate, annual: 150000, waste: 4000, service: 16000 };
    const annual = grossQuote(quoteStay({ type: "annuale", startDate: "2026-01-01", endDate: "2026-12-31", rate: r, periods }), r, "annuale", { vatRate: 22, vatIncluded: false });
    expect(annual).toMatchObject({ totalCents: 183000, wasteCents: 4880, serviceCents: 19520 });
    const transit = grossQuote(quoteStay({ type: "transito", startDate: "2026-03-01", endDate: "2026-03-03", rate: r, periods }), r, "transito", { vatRate: 10, vatIncluded: false });
    expect(transit.totalCents).toBe(Math.round((rate.dailyLow * 110) / 100) * 2);
    expect(transit).toMatchObject({ wasteCents: 0, serviceCents: 0 });
    // Listino IVA inclusa: importi invariati.
    expect(grossQuote(quoteStay({ type: "annuale", startDate: "2026-01-01", endDate: "2026-12-31", rate: r, periods }), r, "annuale", { vatRate: 22, vatIncluded: true }).totalCents).toBe(150000);
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
  it("annualEnd: gli annuali vanno per anno solare, fino al 31 dicembre", () => {
    expect(annualEnd("2026-06-01")).toBe("2026-12-31");
    expect(annualEnd("2026-01-01")).toBe("2026-12-31");
    expect(annualEnd("2028-02-29")).toBe("2028-12-31");
  });

  it("yearPeriod: anno in corso da oggi, anno dopo dal 1° gennaio, stagione dal 1/5 al 30/9", () => {
    expect(yearPeriod("annuale", 2026, "2026-11-22")).toEqual({ startDate: "2026-11-22", endDate: "2026-12-31" });
    expect(yearPeriod("annuale", 2027, "2026-11-22")).toEqual({ startDate: "2027-01-01", endDate: "2027-12-31" });
    expect(yearPeriod("stagionale", 2027, "2026-11-22")).toEqual({ startDate: "2027-05-01", endDate: "2027-09-30" });
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
