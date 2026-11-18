// Meteo marino del porto: coordinate, previsioni (Open-Meteo: vento e mare), scale Beaufort e Douglas, maree e
// allerte (burrasca, raffiche, onda). Funzioni pure, usate da server e pagine.

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
  /** Vento medio e raffiche in nodi; direzione da cui soffia, in gradi. */
  windKn: number;
  gustKn: number;
  windDir: number;
  code: number;
  tempC: number;
  /** Onda significativa (vento + mare lungo): altezza in metri, direzione di provenienza, periodo in secondi. */
  waveM: number | null;
  waveDir: number | null;
  wavePeriodS: number | null;
  /** Mare lungo (onda formata lontano, arriva anche senza vento in porto). */
  swellM: number | null;
  swellDir: number | null;
  swellPeriodS: number | null;
  /** Corrente superficiale in nodi; direzione verso cui va, in gradi. */
  currentKn: number | null;
  currentDir: number | null;
  /** Livello del mare rispetto al medio (marea + pressione), in metri. */
  seaLevelM: number | null;
  seaTempC: number | null;
}

type Series = (number | null)[];
type OpenMeteoForecast = {
  hourly: { time: string[]; wind_speed_10m: Series; wind_gusts_10m: Series; wind_direction_10m: Series; weather_code: Series; temperature_2m: Series };
};
export type OpenMeteoMarine = {
  hourly: { time: string[] } & Partial<
    Record<
      | "wave_height"
      | "wave_direction"
      | "wave_period"
      | "swell_wave_height"
      | "swell_wave_direction"
      | "swell_wave_period"
      | "ocean_current_velocity"
      | "ocean_current_direction"
      | "sea_level_height_msl"
      | "sea_surface_temperature",
      Series
    >
  >;
};

/** Variabili chieste al servizio marino di Open-Meteo. */
export const MARINE_VARIABLES =
  "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,ocean_current_velocity,ocean_current_direction,sea_level_height_msl,sea_surface_temperature";

const KMH_PER_KNOT = 1.852;
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Unisce le risposte di Open-Meteo (meteo e mare) in un elenco orario. Il mare può mancare del tutto (porti interni,
 * servizio giù) o in parte (alcune variabili non coperte): i valori mancanti restano vuoti.
 */
export function parseForecast(forecast: OpenMeteoForecast, marine: OpenMeteoMarine | null): WeatherHour[] {
  const index = new Map<string, number>();
  marine?.hourly?.time?.forEach((t, i) => index.set(t, i));
  const sea = (key: keyof Omit<OpenMeteoMarine["hourly"], "time">, time: string, map: (v: number) => number = (v) => v): number | null => {
    const i = index.get(time);
    const v = i === undefined ? null : marine?.hourly[key]?.[i];
    return v === null || v === undefined ? null : map(v);
  };
  const h = forecast.hourly;
  return h.time.map((time, i) => ({
    time,
    windKn: Math.round(h.wind_speed_10m[i] ?? 0),
    gustKn: Math.round(h.wind_gusts_10m[i] ?? 0),
    windDir: h.wind_direction_10m[i] ?? 0,
    code: h.weather_code[i] ?? 0,
    tempC: Math.round(h.temperature_2m[i] ?? 0),
    waveM: sea("wave_height", time, round1),
    waveDir: sea("wave_direction", time),
    wavePeriodS: sea("wave_period", time, Math.round),
    swellM: sea("swell_wave_height", time, round1),
    swellDir: sea("swell_wave_direction", time),
    swellPeriodS: sea("swell_wave_period", time, Math.round),
    // Open-Meteo dà la corrente in km/h.
    currentKn: sea("ocean_current_velocity", time, (v) => round1(v / KMH_PER_KNOT)),
    currentDir: sea("ocean_current_direction", time),
    seaLevelM: sea("sea_level_height_msl", time, round2),
    seaTempC: sea("sea_surface_temperature", time, Math.round),
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

/** Direzione da cui soffia il vento (o arriva l'onda): sigla e nome del vento («NE», «Grecale»). */
export function windName(deg: number): { short: string; name: string } {
  const [short, name] = WINDS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  return { short, name };
}

/** Sigla della direzione verso cui va (corrente). */
export function towards(deg: number): string {
  return WINDS[Math.round((((deg % 360) + 360) % 360) / 45) % 8][0];
}

// Scala Beaufort: limite inferiore in nodi di ogni forza e nome italiano.
const BEAUFORT: [number, string][] = [
  [0, "Calma"],
  [1, "Bava di vento"],
  [4, "Brezza leggera"],
  [7, "Brezza tesa"],
  [11, "Vento moderato"],
  [17, "Vento teso"],
  [22, "Vento fresco"],
  [28, "Vento forte"],
  [34, "Burrasca moderata"],
  [41, "Burrasca forte"],
  [48, "Tempesta"],
  [56, "Fortunale"],
  [64, "Uragano"],
];

/** Forza Beaufort del vento medio in nodi. Dalla forza 8 è burrasca. */
export function beaufort(kn: number): { force: number; label: string } {
  let force = 0;
  for (let f = 0; f < BEAUFORT.length; f++) if (kn >= BEAUFORT[f][0]) force = f;
  return { force, label: BEAUFORT[force][1] };
}

/** Vento medio da cui si parla di burrasca (forza 8). */
export const GALE_KN = 34;

// Scala Douglas dello stato del mare: altezza massima dell'onda significativa per ogni grado.
const DOUGLAS: [number, string][] = [
  [0, "Calmo"],
  [0.1, "Quasi calmo"],
  [0.5, "Poco mosso"],
  [1.25, "Mosso"],
  [2.5, "Molto mosso"],
  [4, "Agitato"],
  [6, "Molto agitato"],
  [9, "Grosso"],
  [14, "Molto grosso"],
];

/** Stato del mare (scala Douglas) dall'altezza dell'onda significativa. */
export function seaState(waveM: number): { degree: number; label: string } {
  for (let d = 0; d < DOUGLAS.length; d++) if (waveM <= DOUGLAS[d][0]) return { degree: d, label: DOUGLAS[d][1] };
  return { degree: 9, label: "Tempestoso" };
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

export function formatMeters(v: number | null, digits = 1): string {
  return v === null ? "—" : v.toFixed(digits).replace(".", ",");
}

/** L'ora più vicina a «adesso» (ora locale del porto, «AAAA-MM-GGTHH:MM»). */
export function currentHour(hours: WeatherHour[], nowLocal: string): WeatherHour | null {
  const key = `${nowLocal.slice(0, 13)}:00`;
  return hours.find((h) => h.time === key) ?? hours.find((h) => h.time > key) ?? hours.at(-1) ?? null;
}

function ahead(hours: WeatherHour[], nowLocal: string, hoursAhead: number): WeatherHour[] {
  const start = `${nowLocal.slice(0, 13)}:00`;
  return hours.filter((h) => h.time >= start).slice(0, hoursAhead);
}

/** Alte e basse maree (massimi e minimi del livello del mare) nelle prossime ore. */
export function tideTurns(hours: WeatherHour[], nowLocal: string, hoursAhead = 30): { time: string; levelM: number; kind: "alta" | "bassa" }[] {
  const list = ahead(hours, nowLocal, hoursAhead).filter((h) => h.seaLevelM !== null);
  const turns: { time: string; levelM: number; kind: "alta" | "bassa" }[] = [];
  for (let i = 1; i < list.length - 1; i++) {
    const [a, b, c] = [list[i - 1].seaLevelM!, list[i].seaLevelM!, list[i + 1].seaLevelM!];
    if (b > a && b >= c) turns.push({ time: list[i].time, levelM: b, kind: "alta" });
    else if (b < a && b <= c) turns.push({ time: list[i].time, levelM: b, kind: "bassa" });
  }
  return turns;
}

export interface DaySummary {
  date: string;
  maxWindKn: number;
  maxGustKn: number;
  gustDir: number;
  minTempC: number;
  maxTempC: number;
  maxWaveM: number | null;
  maxWaveDir: number | null;
  maxSwellM: number | null;
  maxCurrentKn: number | null;
  code: number;
}

const maxOf = (values: (number | null)[]) => {
  const list = values.filter((v): v is number => v !== null);
  return list.length ? Math.max(...list) : null;
};

/** Riassunto per giorno: massimi di vento, raffiche, onda, mare lungo e corrente; il tempo è quello di mezzogiorno. */
export function dailySummary(hours: WeatherHour[]): DaySummary[] {
  const days = new Map<string, WeatherHour[]>();
  for (const h of hours) days.set(h.time.slice(0, 10), [...(days.get(h.time.slice(0, 10)) ?? []), h]);
  return [...days.entries()].map(([date, list]) => {
    const strongest = list.reduce((a, b) => (b.gustKn > a.gustKn ? b : a));
    const maxWaveM = maxOf(list.map((h) => h.waveM));
    return {
      date,
      maxWindKn: Math.max(...list.map((h) => h.windKn)),
      maxGustKn: strongest.gustKn,
      gustDir: strongest.windDir,
      minTempC: Math.min(...list.map((h) => h.tempC)),
      maxTempC: Math.max(...list.map((h) => h.tempC)),
      maxWaveM,
      maxWaveDir: maxWaveM === null ? null : (list.find((h) => h.waveM === maxWaveM)?.waveDir ?? null),
      maxSwellM: maxOf(list.map((h) => h.swellM)),
      maxCurrentKn: maxOf(list.map((h) => h.currentKn)),
      code: (list.find((h) => h.time.endsWith("12:00")) ?? list[Math.floor(list.length / 2)]).code,
    };
  });
}

// ───────────────────────── Allerte ─────────────────────────

export interface MarineAlert {
  /** burrasca: vento medio da forza 8; raffiche: oltre la soglia del porto; onda: oltre la soglia del porto. */
  kind: "burrasca" | "raffiche" | "onda";
  /** Valore massimo: nodi (burrasca, raffiche) o metri (onda). */
  peak: number;
  at: string;
  from: string;
  to: string;
  /** Direzione di provenienza del vento o dell'onda al massimo. */
  dir: number | null;
}

export interface AlertThresholds {
  gustKn: number;
  waveM: number;
}

/** Condizioni pericolose nelle prossime `hoursAhead` ore: burrasca, raffiche oltre soglia, onda oltre soglia. */
export function marineAlerts(hours: WeatherHour[], thresholds: AlertThresholds, nowLocal: string, hoursAhead = 48): MarineAlert[] {
  const window = ahead(hours, nowLocal, hoursAhead);
  const build = (kind: MarineAlert["kind"], value: (h: WeatherHour) => number | null, limit: number, dir: (h: WeatherHour) => number | null): MarineAlert | null => {
    const over = window.filter((h) => (value(h) ?? -1) >= limit);
    if (over.length === 0) return null;
    const peak = over.reduce((a, b) => ((value(b) ?? 0) > (value(a) ?? 0) ? b : a));
    return { kind, peak: value(peak)!, at: peak.time, from: over[0].time, to: over.at(-1)!.time, dir: dir(peak) };
  };
  return [
    build("burrasca", (h) => h.windKn, GALE_KN, (h) => h.windDir),
    build("raffiche", (h) => h.gustKn, thresholds.gustKn, (h) => h.windDir),
    build("onda", (h) => h.waveM, thresholds.waveM, (h) => h.waveDir),
  ].filter((a): a is MarineAlert => a !== null);
}

const DAY_NAMES = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

/** «oggi alle 15», «domani alle 9», «giovedì alle 18»; le 0 sono la mezzanotte del giorno prima. */
export function whenLabel(time: string, todayLocal: string): string {
  const hourNum = Number(time.slice(11, 13));
  const date = hourNum === 0 ? new Date(Date.parse(`${time.slice(0, 10)}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : time.slice(0, 10);
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayLocal}T00:00:00Z`)) / 86_400_000);
  const day = days === 0 ? "oggi" : days === 1 ? "domani" : days === -1 ? "ieri" : DAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return hourNum === 0 ? `${day} a mezzanotte` : `${day} alle ${hourNum}`;
}

/** Una riga che descrive l'allerta, per la striscia rossa e per il messaggio. */
export function alertLine(alert: MarineAlert, todayLocal: string): string {
  const from = alert.dir === null ? "" : ` da ${windName(alert.dir).short} (${windName(alert.dir).name})`;
  const when = `${whenLabel(alert.at, todayLocal)}; da ${whenLabel(alert.from, todayLocal)} a ${whenLabel(alert.to, todayLocal)}`;
  if (alert.kind === "burrasca") return `Burrasca: vento medio fino a ${alert.peak} nodi (forza ${beaufort(alert.peak).force}, ${beaufort(alert.peak).label.toLowerCase()})${from}, ${when}.`;
  if (alert.kind === "raffiche") return `Raffiche fino a ${alert.peak} nodi${from}, ${when}.`;
  return `Onde fino a ${formatMeters(alert.peak)} m (mare ${seaState(alert.peak).label.toLowerCase()})${from}, ${when}.`;
}

/**
 * Testo proposto per l'avviso ai diportisti: condizioni del mare e del vento e, se c'è, l'allerta della Protezione
 * Civile (righe già pronte, da src/lib/civil-protection.ts).
 */
export function alertMessage(alerts: MarineAlert[], todayLocal: string, civil: { title: string; lines: string[] } | null = null): { title: string; body: string } {
  const gale = alerts.find((a) => a.kind === "burrasca");
  const gust = alerts.find((a) => a.kind === "raffiche");
  const wave = alerts.find((a) => a.kind === "onda");
  const title = gale
    ? `Avviso di burrasca: vento fino a ${gale.peak} nodi`
    : gust
      ? `Allerta vento: raffiche fino a ${gust.peak} nodi`
      : wave
        ? `Mare agitato: onde fino a ${formatMeters(wave.peak)} m`
        : (civil?.title ?? "Avviso meteo");
  const advice = alerts.length
    ? ["Controllate ormeggi, cime e parabordi, raddoppiate le cime se serve, chiudete tendalini e capottine. Sconsigliate le uscite in mare."]
    : [];
  return {
    title,
    body: [
      ...(alerts.length ? ["Previsioni per il porto:", ...alerts.map((a) => `• ${alertLine(a, todayLocal)}`)] : []),
      ...(civil ? [...(alerts.length ? [""] : []), ...civil.lines] : []),
      "",
      ...advice,
      "Per qualsiasi necessità contattate il porto.",
    ].join("\n"),
  };
}
