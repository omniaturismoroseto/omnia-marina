import { addDays, addMonths, diffDays } from "./dates";

export type Season = "bassa" | "media" | "alta";
export type StayType = "annuale" | "stagionale" | "mensile" | "transito";

export interface SeasonPeriod {
  season: Season;
  startDate: string;
  endDate: string; // incluso
}

export interface RateRow {
  dailyLow: number;
  dailyMid: number;
  dailyHigh: number;
  monthlyLow: number;
  monthlyMid: number;
  monthlyHigh: number;
  annual: number;
}

export interface QuoteLine {
  label: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface Quote {
  totalCents: number;
  lines: QuoteLine[];
}

const SEASON_LABEL: Record<Season, string> = {
  bassa: "bassa stagione",
  media: "media stagione",
  alta: "alta stagione",
};

// Fuori dai periodi dichiarati è bassa stagione; se due periodi si sovrappongono vince il più alto.
export function seasonForDate(periods: SeasonPeriod[], date: string): Season {
  let found: Season = "bassa";
  for (const p of periods) {
    if (p.startDate <= date && date <= p.endDate) {
      if (p.season === "alta") return "alta";
      if (p.season === "media") found = "media";
    }
  }
  return found;
}

// Primo giorno in cui il posto torna libero.
// Transito: il giorno di partenza è già libero per un nuovo arrivo (minimo una notte).
// Altri contratti: la data di fine è l'ultimo giorno occupato.
export function occupiedUntil(type: StayType, startDate: string, endDate: string): string {
  if (type === "transito") return endDate > startDate ? endDate : addDays(startDate, 1);
  return addDays(endDate, 1);
}

function dailyRate(rate: RateRow, season: Season): number {
  return season === "alta" ? rate.dailyHigh : season === "media" ? rate.dailyMid : rate.dailyLow;
}

function monthlyRate(rate: RateRow, season: Season): number {
  return season === "alta" ? rate.monthlyHigh : season === "media" ? rate.monthlyMid : rate.monthlyLow;
}

const SEASON_ORDER: Season[] = ["bassa", "media", "alta"];

function linesBySeason(counts: Record<Season, number>, unit: (s: Season) => number, label: (s: Season, n: number) => string): QuoteLine[] {
  return SEASON_ORDER.filter((s) => counts[s] > 0).map((s) => ({
    label: label(s, counts[s]),
    quantity: counts[s],
    unitCents: unit(s),
    amountCents: unit(s) * counts[s],
  }));
}

function countDays(periods: SeasonPeriod[], from: string, untilExclusive: string): Record<Season, number> {
  const counts: Record<Season, number> = { bassa: 0, media: 0, alta: 0 };
  const days = diffDays(from, untilExclusive);
  for (let i = 0; i < days; i++) counts[seasonForDate(periods, addDays(from, i))]++;
  return counts;
}

/**
 * Calcola l'importo di listino (IVA inclusa) per un periodo di ormeggio.
 * - transito: tariffa giornaliera per ogni notte, secondo la stagione di ciascun giorno;
 * - mensile e stagionale: tariffa mensile per ogni mese intero (stagione del primo giorno del mese),
 *   più tariffa giornaliera per i giorni che avanzano;
 * - annuale: canone annuale fisso.
 */
export function quoteStay(input: {
  type: StayType;
  startDate: string;
  endDate: string;
  rate: RateRow;
  periods: SeasonPeriod[];
}): Quote {
  const { type, startDate, endDate, rate, periods } = input;
  const until = occupiedUntil(type, startDate, endDate);
  let lines: QuoteLine[];

  if (type === "annuale") {
    lines = [{ label: "Canone annuale", quantity: 1, unitCents: rate.annual, amountCents: rate.annual }];
  } else if (type === "transito") {
    lines = linesBySeason(
      countDays(periods, startDate, until),
      (s) => dailyRate(rate, s),
      (s, n) => `${n === 1 ? "Notte" : "Notti"} in ${SEASON_LABEL[s]}`,
    );
  } else {
    const months: Record<Season, number> = { bassa: 0, media: 0, alta: 0 };
    let k = 0;
    // I mesi si contano sempre dalla data di inizio, così il 31 non "scivola" dopo febbraio.
    while (addMonths(startDate, k + 1) <= until) {
      months[seasonForDate(periods, addMonths(startDate, k))]++;
      k++;
    }
    lines = [
      ...linesBySeason(
        months,
        (s) => monthlyRate(rate, s),
        (s, n) => `${n === 1 ? "Mese" : "Mesi"} in ${SEASON_LABEL[s]}`,
      ),
      ...linesBySeason(
        countDays(periods, addMonths(startDate, k), until),
        (s) => dailyRate(rate, s),
        (s, n) => `${n === 1 ? "Giorno" : "Giorni"} in ${SEASON_LABEL[s]}`,
      ),
    ];
  }

  return { lines, totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0) };
}

// La categoria tariffaria più piccola in cui la barca rientra per lunghezza e larghezza.
export function categoryForBoat<T extends { maxLengthCm: number; maxBeamCm: number }>(
  categories: T[],
  boat: { lengthCm: number; beamCm: number },
): T | null {
  const fitting = categories
    .filter((c) => boat.lengthCm <= c.maxLengthCm && boat.beamCm <= c.maxBeamCm)
    .sort((a, b) => a.maxLengthCm - b.maxLengthCm || a.maxBeamCm - b.maxBeamCm);
  return fitting[0] ?? null;
}

// Divide un totale in rate uguali; gli eventuali centesimi di resto vanno sull'ultima.
export function splitInstalments(totalCents: number, count: number, firstDueDate: string, everyMonths: number) {
  const base = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    dueDate: addMonths(firstDueDate, i * everyMonths),
    amountCents: i === count - 1 ? totalCents - base * (count - 1) : base,
  }));
}
