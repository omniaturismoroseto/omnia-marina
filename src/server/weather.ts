import "server-only";
import { readFile } from "node:fs/promises";
import { MARINE_VARIABLES, parseForecast, type WeatherHour } from "@/lib/weather";

// Previsioni per il porto da Open-Meteo (gratuito, senza chiave): vento, raffiche e tempo, più onda, mare lungo,
// corrente, livello del mare e temperatura dell'acqua dal servizio marino. Si tengono in memoria 30 minuti per posizione. Per le prove locali WEATHER_FIXTURE (percorso di un JSON
// con { forecast, marine }) sostituisce la chiamata.

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; hours: WeatherHour[] }>();

/** Ora locale del porto (Europa/Roma) nel formato delle previsioni: «AAAA-MM-GGTHH:MM». */
export function nowRomeLocal(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json();
}

/** Previsioni orarie per 3 giorni, oppure null se il servizio non risponde o mancano le coordinate. */
export async function portForecast(latitude: number | null, longitude: number | null): Promise<WeatherHour[] | null> {
  if (latitude === null || longitude === null) return null;
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.hours;

  try {
    let hours: WeatherHour[];
    if (process.env.WEATHER_FIXTURE) {
      const fixture = JSON.parse(await readFile(process.env.WEATHER_FIXTURE, "utf8"));
      hours = parseForecast(fixture.forecast, fixture.marine ?? null);
    } else {
      const common = `latitude=${latitude}&longitude=${longitude}&timezone=Europe%2FRome&forecast_days=3`;
      const [forecast, marine] = await Promise.all([
        fetchJson(`https://api.open-meteo.com/v1/forecast?${common}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code,temperature_2m&wind_speed_unit=kn`),
        // Il mare può non esserci (porto su un lago, servizio giù): le previsioni del vento bastano.
        fetchJson(`https://marine-api.open-meteo.com/v1/marine?${common}&hourly=${MARINE_VARIABLES}`).catch(() => null),
      ]);
      hours = parseForecast(forecast, marine);
    }
    cache.set(key, { at: Date.now(), hours });
    return hours;
  } catch (error) {
    console.error("Previsioni meteo non disponibili", error);
    return hit?.hours ?? null;
  }
}

/** Vero se l'allerta vento è stata inviata nelle ultime 24 ore: in quel caso non si ripropone. */
export function alertSentRecently(sentAt: Date | null, now: Date = new Date()): boolean {
  return sentAt !== null && now.getTime() - sentAt.getTime() < 24 * 60 * 60 * 1000;
}
