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
  /** Canone fisso dei contratti stagionali; 0 = si calcola dalle tariffe mensili. */
  seasonal: number;
  /** Quota rifiuti proposta nei contratti annuali come voce a parte (non entra nel canone). */
  waste: number;
  /** Condominio (spese di gestione comuni) proposto nei contratti annuali come voce a parte. */
  service: number;
}

export const RATE_FIELDS = ["dailyLow", "dailyMid", "dailyHigh", "monthlyLow", "monthlyMid", "monthlyHigh", "annual", "seasonal", "waste", "service"] as const;

/** Importo IVA compresa: se il listino ha prezzi netti, aggiunge l'IVA. I contratti lavorano sempre IVA compresa. */
export function withVat(cents: number, vatRate: number, vatIncluded: boolean): number {
  return vatIncluded ? cents : Math.round((cents * (100 + vatRate)) / 100);
}

/**
 * Costo di un anno, come nelle colonne «IVA» e «Totale annuo» delle tariffe: canone annuale, rifiuti e condominio, più l'IVA
 * (o con l'IVA già dentro, se il listino ha prezzi IVA inclusa).
 */
export function annualTotal(rate: Pick<RateRow, "annual" | "waste" | "service">, vatRate: number, vatIncluded: boolean) {
  const sum = rate.annual + rate.waste + rate.service;
  const totalCents = withVat(sum, vatRate, vatIncluded);
  const netCents = vatIncluded ? Math.round(sum / (1 + vatRate / 100)) : sum;
  return { netCents, vatCents: totalCents - netCents, totalCents };
}

/**
 * Tariffa di una categoria su un pontile con prezzi propri (pierId vuoto = tariffa base): ogni importo del pontile,
 * se compilato, prende il posto di quello della tariffa base. Così un pontile può ritoccare solo gli annuali e
 * continuare a usare i prezzi base per transiti e mensili. Restituisce null se non c'è nessuna delle due righe.
 * Per un pontile che usa la tariffa base (piers.base_rate) si passa null: vedi `ratePierId`.
 */
export function pierRate<T extends RateRow & { pierId: string | null }>(rows: T[], pierId: string | null): RateRow | null {
  const base = rows.find((r) => r.pierId === null) ?? null;
  const own = pierId ? (rows.find((r) => r.pierId === pierId) ?? null) : null;
  if (!base && !own) return null;
  const merged = {} as RateRow;
  for (const field of RATE_FIELDS) merged[field] = own?.[field] || base?.[field] || 0;
  return merged;
}

/** Pontili con lo stesso nome (maiuscole e spazi a parte) hanno un'unica tariffa: questa è la chiave che li unisce. */
export function pierGroupKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("it");
}

export interface PierGroup<T> {
  key: string;
  name: string;
  piers: T[];
  ids: string[];
  /** Acceso se tutti i pontili del gruppo usano la tariffa base. */
  baseRate: boolean;
}

/** Raggruppa i pontili per nome, nell'ordine in cui arrivano: in Tariffe ogni nome compare una volta sola. */
export function groupPiersByName<T extends { id: string; name: string; baseRate: boolean }>(piers: T[]): PierGroup<T>[] {
  const groups = new Map<string, PierGroup<T>>();
  for (const pier of piers) {
    const key = pierGroupKey(pier.name);
    const group = groups.get(key);
    if (group) {
      group.piers.push(pier);
      group.ids.push(pier.id);
      group.baseRate &&= pier.baseRate;
    } else {
      groups.set(key, { key, name: pier.name.trim(), piers: [pier], ids: [pier.id], baseRate: pier.baseRate });
    }
  }
  return [...groups.values()];
}

/** Il pontile di cui leggere i prezzi propri: nessuno se usa la tariffa base. */
export function ratePierId(pier: { id: string; baseRate: boolean } | null | undefined): string | null {
  return pier && !pier.baseRate ? pier.id : null;
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

/**
 * I giorni di bassa stagione di un listino, a tratti continui: tutto ciò che, tra inizio e fine del listino, non rientra
 * in un periodo di media o alta stagione. Servono a mostrare la bassa stagione accanto ai periodi dichiarati.
 */
export function lowSeasonRanges(periods: SeasonPeriod[], from: string, to: string): { startDate: string; endDate: string }[] {
  const ranges: { startDate: string; endDate: string }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (seasonForDate(periods, day) !== "bassa") continue;
    const last = ranges[ranges.length - 1];
    if (last && addDays(last.endDate, 1) === day) last.endDate = day;
    else ranges.push({ startDate: day, endDate: day });
  }
  return ranges;
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
 * - stagionale con canone fisso: il canone, qualunque sia il periodo;
 * - mensile e stagionale senza canone fisso: tariffa mensile per ogni mese intero (stagione del primo giorno
 *   del mese), più tariffa giornaliera per i giorni che avanzano;
 * - annuale: canone annuale fisso.
 * La quota rifiuti del listino non entra nel canone: il contratto la propone come voce a parte.
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
  } else if (type === "stagionale" && rate.seasonal > 0) {
    lines = [{ label: "Canone stagionale", quantity: 1, unitCents: rate.seasonal, amountCents: rate.seasonal }];
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

/**
 * Preventivo IVA compresa a partire da quello del listino: righe e totale con l'IVA aggiunta se il listino ha prezzi netti,
 * e rifiuti e condominio da proporre come voci dei contratti annuali.
 */
export function grossQuote(quote: Quote, rate: RateRow, type: StayType, list: { vatRate: number; vatIncluded: boolean }): Quote & { wasteCents: number; serviceCents: number } {
  const gross = (cents: number) => withVat(cents, list.vatRate, list.vatIncluded);
  const lines = quote.lines.map((l) => ({ ...l, unitCents: gross(l.unitCents), amountCents: gross(l.unitCents) * l.quantity }));
  return {
    lines,
    totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0),
    wasteCents: type === "annuale" ? gross(rate.waste) : 0,
    serviceCents: type === "annuale" ? gross(rate.service) : 0,
  };
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
