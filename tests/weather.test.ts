import { describe, expect, it } from "vitest";
import {
  alertMessage,
  beaufort,
  currentHour,
  dailySummary,
  marineAlerts,
  parseCoordinates,
  parseForecast,
  seaState,
  tideTurns,
  whenLabel,
  windName,
  type WeatherHour,
} from "../src/lib/weather";

describe("coordinate", () => {
  it("accetta i formati di Google Maps e la virgola decimale", () => {
    expect(parseCoordinates("42.65890, 14.02560")).toEqual({ latitude: 42.6589, longitude: 14.0256 });
    expect(parseCoordinates("42,6589 14,0256")).toEqual({ latitude: 42.6589, longitude: 14.0256 });
    expect(parseCoordinates("42,6589; 14,0256")).toEqual({ latitude: 42.6589, longitude: 14.0256 });
    expect(parseCoordinates("42.6589° N, 14.0256° E")).toEqual({ latitude: 42.6589, longitude: 14.0256 });
    expect(parseCoordinates("120, 14")).toBeNull();
    expect(parseCoordinates("porto")).toBeNull();
  });
});

describe("scale", () => {
  it("venti, Beaufort e Douglas", () => {
    expect(windName(44)).toEqual({ short: "NE", name: "Grecale" });
    expect(windName(225)).toEqual({ short: "SO", name: "Libeccio" });
    expect(beaufort(0)).toEqual({ force: 0, label: "Calma" });
    expect(beaufort(25)).toEqual({ force: 6, label: "Vento fresco" });
    expect(beaufort(34)).toEqual({ force: 8, label: "Burrasca moderata" });
    expect(beaufort(45).force).toBe(9);
    expect(seaState(0.3).label).toBe("Poco mosso");
    expect(seaState(1.25).label).toBe("Mosso");
    expect(seaState(3).label).toBe("Agitato");
    expect(seaState(20).label).toBe("Tempestoso");
  });
});

const hour = (time: string, extra: Partial<WeatherHour> = {}): WeatherHour => ({
  time,
  windKn: 10,
  gustKn: 14,
  windDir: 45,
  code: 1,
  tempC: 15,
  waveM: 0.5,
  waveDir: 40,
  wavePeriodS: 5,
  swellM: null,
  swellDir: null,
  swellPeriodS: null,
  currentKn: null,
  currentDir: null,
  seaLevelM: null,
  seaTempC: null,
  ...extra,
});

describe("previsioni", () => {
  it("unisce meteo e mare, converte la corrente in nodi e tollera i dati mancanti", () => {
    const hours = parseForecast(
      {
        hourly: {
          time: ["2026-11-17T00:00", "2026-11-17T01:00"],
          wind_speed_10m: [10.4, 12],
          wind_gusts_10m: [15.6, 18],
          wind_direction_10m: [180, 190],
          weather_code: [1, 61],
          temperature_2m: [12.4, 12],
        },
      },
      {
        hourly: {
          time: ["2026-11-17T01:00"],
          wave_height: [0.84],
          wave_period: [5.6],
          ocean_current_velocity: [1.852],
          ocean_current_direction: [90],
          sea_level_height_msl: [0.123],
        },
      },
    );
    expect(hours[0]).toMatchObject({ windKn: 10, gustKn: 16, waveM: null, currentKn: null });
    expect(hours[1]).toMatchObject({ waveM: 0.8, wavePeriodS: 6, currentKn: 1, currentDir: 90, seaLevelM: 0.12, swellM: null });
  });

  it("trova maree, allerte di burrasca, raffiche e onda", () => {
    const hours = [
      hour("2026-11-17T10:00", { gustKn: 60, seaLevelM: 0.1 }),
      hour("2026-11-17T12:00", { seaLevelM: 0.2 }),
      hour("2026-11-17T13:00", { seaLevelM: 0.3 }),
      hour("2026-11-17T14:00", { seaLevelM: 0.25 }),
      hour("2026-11-18T15:00", { windKn: 30, gustKn: 38, seaLevelM: 0.1 }),
      hour("2026-11-18T16:00", { windKn: 36, gustKn: 45, waveM: 2.8, waveDir: 30, seaLevelM: 0.15 }),
      hour("2026-11-18T18:00", { windKn: 25, gustKn: 33, waveM: 2.1 }),
    ];
    expect(tideTurns(hours, "2026-11-17T11:40")).toEqual([
      { time: "2026-11-17T13:00", levelM: 0.3, kind: "alta" },
      { time: "2026-11-18T15:00", levelM: 0.1, kind: "bassa" },
    ]);
    const alerts = marineAlerts(hours, { gustKn: 35, waveM: 2.5 }, "2026-11-17T11:40");
    expect(alerts.map((a) => [a.kind, a.peak, a.at])).toEqual([
      ["burrasca", 36, "2026-11-18T16:00"],
      ["raffiche", 45, "2026-11-18T16:00"],
      ["onda", 2.8, "2026-11-18T16:00"],
    ]);
    expect(marineAlerts(hours, { gustKn: 50, waveM: 3 }, "2026-11-18T17:00")).toEqual([]);
    expect(currentHour(hours, "2026-11-17T11:40")?.time).toBe("2026-11-17T12:00");

    const text = alertMessage(alerts, "2026-11-17", { title: "Allerta arancione", lines: ["Protezione Civile: arancione domani."] });
    expect(text.title).toBe("Avviso di burrasca: vento fino a 36 nodi");
    expect(text.body).toContain("Burrasca: vento medio fino a 36 nodi (forza 8, burrasca moderata) da NE (Grecale), domani alle 16");
    expect(text.body).toContain("Onde fino a 2,8 m (mare agitato)");
    expect(text.body).toContain("Protezione Civile: arancione domani.");
    expect(alertMessage([], "2026-11-17", { title: "Allerta rossa della Protezione Civile oggi", lines: ["x"] }).title).toBe("Allerta rossa della Protezione Civile oggi");
  });

  it("riassume per giorno", () => {
    const days = dailySummary([hour("2026-11-17T09:00"), hour("2026-11-17T12:00", { code: 61, currentKn: 0.4 }), hour("2026-11-18T12:00", { waveM: 2.1, swellM: 1.2 })]);
    expect(days[0]).toMatchObject({ date: "2026-11-17", code: 61, maxCurrentKn: 0.4, maxSwellM: null });
    expect(days[1]).toMatchObject({ maxWaveM: 2.1, maxWaveDir: 40, maxSwellM: 1.2 });
    expect(whenLabel("2026-11-18T16:00", "2026-11-17")).toBe("domani alle 16");
    expect(whenLabel("2026-11-19T00:00", "2026-11-17")).toBe("domani a mezzanotte");
  });
});
