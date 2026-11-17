// Meteo del porto: coordinate, previsioni (Open-Meteo) e allerta vento. Funzioni pure, usate da server e pagine.

/**
 * Coordinate scritte o copiate da Google Maps («41.8902, 12.4922»), anche con la virgola decimale
 * («41,8902 12,4922» o «41,8902; 12,4922»). Null se non sono due numeri validi.
 */
export function parseCoordinates(input: string): { latitude: number; longitude: number } | null {
  const text = input.trim().replace(/[°NE]/gi, " ");
  let parts: string[];
  if (text.includes(";")) parts = text.split(";");
  else if (text.includes(".")) parts = text.split(/[,\s]+/);
  else parts = text.split(/\s+/);
  parts = parts.map((p) => p.trim().replace(",", ".")).filter((p) => p !== "");
  if (parts.length !== 2 || !parts.every((p) => /^-?\d+(\.\d+)?$/.test(p))) return null;
  const [latitude, longitude] = parts.map(Number);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function formatCoordinates(latitude: number | null, longitude: number | null): string {
  return latitude === null || longitude === null ? "" : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

// ───────────────────────── Previsioni ─────────────────────────

export interface WeatherHour {
  /** Ora locale del porto, «AAAA-MM-GGTHH:MM». */
  time: string;
  windKn: number;
  gustKn: number;
  windDir: number;
  code: number;
  tempC: number;
  waveM: number | null;
}

type OpenMeteoForecast = {
  hourly: { time: string[]; wind_speed_10m: number[]; wind_gusts_10m: number[]; wind_direction_10m: number[]; weather_code: number[]; temperature_2m: number[] };
};
type OpenMeteoMarine = { hourly: { time: string[]; wave_height: (number | null)[] } };

/** Unisce le risposte di Open-Meteo (meteo e mare) in un elenco orario. Il mare può mancare (porti interni, errori). */
export function parseForecast(forecast: OpenMeteoForecast, marine: OpenMeteoMarine | null): WeatherHour[] {
  const waves = new Map<string, number | null>();
  if (marine?.hourly?.time) marine.hourly.time.forEach((t, i) => waves.set(t, marine.hourly.wave_height[i] ?? null));
  const h = forecast.hourly;
  return h.time.map((time, i) => ({
    time,
    windKn: Math.round(h.wind_speed_10m[i] ?? 0),
    gustKn: Math.round(h.wind_gusts_10m[i] ?? 0),
    windDir: h.wind_direction_10m[i] ?? 0,
    code: h.weather_code[i] ?? 0,
    tempC: Math.round(h.temperature_2m[i] ?? 0),
    waveM: waves.get(time) ?? null,
  }));
}

const WINDS = [
  ["N", "Tramontana"],
  ["NE", "Grecale"],
  ["E", "Levante"],
  ["SE", "Scirocco"],
  ["S", "Ostro"],
  ["SO", "Libeccio"],
  ["O", "Ponente"],
  ["NO", "Maestrale"],
] as const;

/** Direzione da cui soffia il vento: sigla e nome del vento («NE», «Grecale»). */
export function windName(deg: number): { short: string; name: string } {
  const [short, name] = WINDS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  return { short, name };
}

/** Descrizione del tempo dal codice WMO usato da Open-Meteo. */
export function weatherLabel(code: number): string {
  if (code === 0) return "Sereno";
  if (code <= 2) return "Poco nuvoloso";
  if (code === 3) return "Coperto";
  if (code <= 48) return "Nebbia";
  if (code <= 57) return "Pioviggine";
  if (code <= 67) return "Pioggia";
  if (code <= 77) return "Neve";
  if (code <= 82) return "Rovesci";
  if (code <= 86) return "Rovesci di neve";
  return "Temporale";
}

/** L'ora più vicina a «adesso» (ora locale del porto, «AAAA-MM-GGTHH:MM»). */
export function currentHour(hours: WeatherHour[], nowLocal: string): WeatherHour | null {
  const key = `${nowLocal.slice(0, 13)}:00`;
  return hours.find((h) => h.time === key) ?? hours.find((h) => h.time > key) ?? hours.at(-1) ?? null;
}

export interface DaySummary {
  date: string;
  maxWindKn: number;
  maxGustKn: number;
  gustDir: number;
  minTempC: number;
  maxTempC: number;
  maxWaveM: number | null;
  code: number;
}

/** Riassunto per giorno: massimi di vento, raffiche e onda; il tempo è quello di mezzogiorno. */
export function dailySummary(hours: WeatherHour[]): DaySummary[] {
  const days = new Map<string, WeatherHour[]>();
  for (const h of hours) days.set(h.time.slice(0, 10), [...(days.get(h.time.slice(0, 10)) ?? []), h]);
  return [...days.entries()].map(([date, list]) => {
    const strongest = list.reduce((a, b) => (b.gustKn > a.gustKn ? b : a));
    const waves = list.map((h) => h.waveM).filter((w): w is number => w !== null);
    return {
      date,
      maxWindKn: Math.max(...list.map((h) => h.windKn)),
      maxGustKn: strongest.gustKn,
      gustDir: strongest.windDir,
      minTempC: Math.min(...list.map((h) => h.tempC)),
      maxTempC: Math.max(...list.map((h) => h.tempC)),
      maxWaveM: waves.length ? Math.max(...waves) : null,
      code: (list.find((h) => h.time.endsWith("12:00")) ?? list[Math.floor(list.length / 2)]).code,
    };
  });
}

export interface WindAlert {
  maxGustKn: number;
  /** Ora della raffica più forte. */
  at: string;
  /** Prima e ultima ora oltre la soglia. */
  from: string;
  to: string;
  dir: number;
}

/** Raffiche oltre la soglia nelle prossime `hoursAhead` ore (da adesso). Null se non ce ne sono. */
export function windAlert(hours: WeatherHour[], thresholdKn: number, nowLocal: string, hoursAhead = 48): WindAlert | null {
  const start = `${nowLocal.slice(0, 13)}:00`;
  const window = hours.filter((h) => h.time >= start).slice(0, hoursAhead);
  const over = window.filter((h) => h.gustKn >= thresholdKn);
  if (over.length === 0) return null;
  const peak = over.reduce((a, b) => (b.gustKn > a.gustKn ? b : a));
  return { maxGustKn: peak.gustKn, at: peak.time, from: over[0].time, to: over.at(-1)!.time, dir: peak.windDir };
}

const DAY_NAMES = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

/** «oggi alle 15», «domani alle 9», «giovedì alle 18». */
export function whenLabel(time: string, todayLocal: string): string {
  const date = time.slice(0, 10);
  const hour = String(Number(time.slice(11, 13)));
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayLocal}T00:00:00Z`)) / 86_400_000);
  const day = days === 0 ? "oggi" : days === 1 ? "domani" : DAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return `${day} alle ${hour}`;
}

/** Testo proposto per l'allerta ai diportisti. */
export function alertMessage(alert: WindAlert, todayLocal: string): { title: string; body: string } {
  const wind = windName(alert.dir);
  return {
    title: `Allerta vento: raffiche fino a ${alert.maxGustKn} nodi`,
    body: [
      `Le previsioni danno raffiche fino a ${alert.maxGustKn} nodi da ${wind.short} (${wind.name}), ${whenLabel(alert.at, todayLocal)}.`,
      `Il vento forte è previsto da ${whenLabel(alert.from, todayLocal)} a ${whenLabel(alert.to, todayLocal)}.`,
      "Controllate gli ormeggi e i parabordi, raddoppiate le cime se serve, chiudete tendalini e capottine.",
      "Per qualsiasi necessità contattate il porto.",
    ].join("\n"),
  };
}
