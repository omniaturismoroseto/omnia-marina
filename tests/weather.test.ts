import { describe, expect, it } from "vitest";
import { alertMessage, currentHour, dailySummary, parseCoordinates, parseForecast, whenLabel, windAlert, windName, type WeatherHour } from "../src/lib/weather";

describe("coordinate", () => {
  it("accetta i formati di Google Maps e la virgola decimale", () => {
    expect(parseCoordinates("42.65890, 14.02560")).toEqual({ latitude: 42.6589, longitude: 14.0256 });
    expect(parseCoordinates("42.6589 14.0256")).toEqual({ latitude: 42.6589, longitude: 14.0256 });
    expect(parseCoordinates("42,6589 14,0256")).toEqual({ latitude: 42.6589, longitude: 14.0256 });
    expect(parseCoordinates("42,6589; 14,0256")).toEqual({ latitude: 42.6589, longitude: 14.0256 });
    expect(parseCoordinates("42.6589° N, 14.0256° E")).toEqual({ latitude: 42.6589, longitude: 14.0256 });
    expect(parseCoordinates("120, 14")).toBeNull();
    expect(parseCoordinates("porto")).toBeNull();
  });
});

describe("venti", () => {
  it("dà sigla e nome", () => {
    expect(windName(0)).toEqual({ short: "N", name: "Tramontana" });
    expect(windName(44)).toEqual({ short: "NE", name: "Grecale" });
    expect(windName(135)).toEqual({ short: "SE", name: "Scirocco" });
    expect(windName(225)).toEqual({ short: "SO", name: "Libeccio" });
    expect(windName(350)).toEqual({ short: "N", name: "Tramontana" });
  });
});

const hour = (time: string, gustKn: number, extra: Partial<WeatherHour> = {}): WeatherHour => ({
  time,
  windKn: Math.round(gustKn / 1.4),
  gustKn,
  windDir: 45,
  code: 1,
  tempC: 15,
  waveM: 0.5,
  ...extra,
});

describe("previsioni", () => {
  it("unisce meteo e mare per ora", () => {
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
      { hourly: { time: ["2026-11-17T01:00"], wave_height: [0.8] } },
    );
    expect(hours[0]).toMatchObject({ windKn: 10, gustKn: 16, tempC: 12, waveM: null });
    expect(hours[1]).toMatchObject({ code: 61, waveM: 0.8 });
  });

  it("trova l'allerta solo nelle prossime ore e oltre la soglia", () => {
    const hours = [hour("2026-11-17T10:00", 50), hour("2026-11-17T12:00", 20), hour("2026-11-18T15:00", 34), hour("2026-11-18T16:00", 38), hour("2026-11-18T18:00", 31)];
    const alert = windAlert(hours, 30, "2026-11-17T11:40");
    expect(alert).toEqual({ maxGustKn: 38, at: "2026-11-18T16:00", from: "2026-11-18T15:00", to: "2026-11-18T18:00", dir: 45 });
    expect(windAlert(hours, 40, "2026-11-17T11:40")).toBeNull();
    expect(currentHour(hours, "2026-11-17T11:40")?.time).toBe("2026-11-17T12:00");
  });

  it("riassume per giorno e scrive l'allerta", () => {
    const days = dailySummary([hour("2026-11-17T09:00", 20), hour("2026-11-17T12:00", 28, { code: 61 }), hour("2026-11-18T12:00", 40, { waveM: 2.1 })]);
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ date: "2026-11-17", maxGustKn: 28, code: 61 });
    expect(days[1].maxWaveM).toBe(2.1);
    expect(whenLabel("2026-11-18T16:00", "2026-11-17")).toBe("domani alle 16");
    expect(whenLabel("2026-11-19T09:00", "2026-11-17")).toBe("giovedì alle 9");
    const text = alertMessage({ maxGustKn: 38, at: "2026-11-18T16:00", from: "2026-11-18T15:00", to: "2026-11-18T18:00", dir: 45 }, "2026-11-17");
    expect(text.title).toBe("Allerta vento: raffiche fino a 38 nodi");
    expect(text.body).toContain("da NE (Grecale), domani alle 16");
  });
});
