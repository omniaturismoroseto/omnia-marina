// Utilità per date "di calendario" in formato ISO (AAAA-MM-GG), senza fuso orario.

const TZ = "Europe/Rome";

export function todayRome(now: Date = new Date()): string {
  // Il formato en-CA produce AAAA-MM-GG.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = parseISO(value);
  return !Number.isNaN(d.getTime()) && toISO(d) === value;
}

export function parseISO(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const d = parseISO(value);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

// Aggiunge mesi restando nello stesso giorno, o nell'ultimo del mese se non esiste (31/01 + 1 mese = 28/02).
export function addMonths(value: string, months: number): string {
  const d = parseISO(value);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return toISO(d);
}

// Ultimo giorno di un periodo annuale che inizia in `start`: gli annuali vanno per anno solare, quindi il 31 dicembre
// dell'anno di inizio (01/06/2026 → 31/12/2026).
export function annualEnd(start: string): string {
  return `${start.slice(0, 4)}-12-31`;
}

/** Stagione estiva dei contratti stagionali: dal 1° maggio al 30 settembre. */
export const SEASON_START = "05-01";
export const SEASON_END = "09-30";

/**
 * Periodo proposto per un contratto stagionale o annuale nell'anno `year`. L'annuale dell'anno in corso parte da `today`
 * (se l'anno è già cominciato), gli altri dal 1° gennaio; lo stagionale va sempre dal 1/5 al 30/9.
 */
export function yearPeriod(type: "annuale" | "stagionale", year: number, today: string): { startDate: string; endDate: string } {
  if (type === "stagionale") return { startDate: `${year}-${SEASON_START}`, endDate: `${year}-${SEASON_END}` };
  const first = `${year}-01-01`;
  return { startDate: today > first && today.slice(0, 4) === String(year) ? today : first, endDate: `${year}-12-31` };
}

// Giorni da `from` a `to` (positivo se `to` è successivo).
export function diffDays(from: string, to: string): number {
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86_400_000);
}

export function yearOf(value: string): number {
  return Number(value.slice(0, 4));
}

export function monthKey(value: string): string {
  return value.slice(0, 7);
}

const dateFmt = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const dateLongFmt = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dateShortFmt = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short" });
const monthFmt = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", month: "long", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export function formatDate(value: string | null | undefined): string {
  return value ? dateFmt.format(parseISO(value)) : "—";
}

export function formatDateLong(value: string): string {
  return dateLongFmt.format(parseISO(value));
}

export function formatDateShort(value: string): string {
  return dateShortFmt.format(parseISO(value));
}

export function formatMonth(key: string): string {
  return monthFmt.format(parseISO(`${key}-01`));
}

export function formatDateTime(value: Date | null | undefined): string {
  return value ? dateTimeFmt.format(value) : "—";
}

export function formatTime(value: Date): string {
  return timeFmt.format(value);
}
