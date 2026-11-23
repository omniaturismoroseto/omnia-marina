import { describe, expect, it } from "vitest";
import { boatFit, boatModelLabel, initials, stayOf } from "@/lib/berth-panel";

describe("stayOf", () => {
  it("dice quando parte la barca", () => {
    expect(stayOf("2026-11-22", "2026-11-23", "2026-11-22")).toMatchObject({ label: "parte domani", late: false });
    expect(stayOf("2026-11-22", "2026-11-23", "2026-11-23")).toMatchObject({ label: "parte oggi", progress: 1 });
    expect(stayOf("2026-01-01", "2026-12-31", "2026-12-19").label).toBe("ancora 12 giorni");
  });
  it("segnala le barche ancora sul posto a contratto finito", () => {
    expect(stayOf("2026-05-01", "2026-09-30", "2026-10-02")).toEqual({ progress: 1, label: "scaduto da 2 giorni", late: true });
  });
  it("guarda avanti per i contratti che devono ancora iniziare", () => {
    expect(stayOf("2026-12-01", "2026-12-10", "2026-11-28")).toEqual({ progress: 0, label: "arriva tra 3 giorni", late: false });
    expect(stayOf("2026-12-01", "2026-12-10", "2026-11-30").label).toBe("arriva domani");
  });
  it("misura il periodo trascorso", () => {
    expect(stayOf("2026-01-01", "2026-01-11", "2026-01-06").progress).toBeCloseTo(0.5);
  });
});

describe("boatFit", () => {
  it("calcola lo spazio attorno alla barca", () => {
    expect(boatFit({ lengthCm: 550, beamCm: 250 }, { lengthCm: 490, beamCm: 180 })).toEqual({ lengthCm: 60, beamCm: 70, fits: true });
    expect(boatFit({ lengthCm: 550, beamCm: 250 }, { lengthCm: 600, beamCm: 180 }).fits).toBe(false);
  });
});

describe("initials", () => {
  it("prende le prime due parole, senza la forma societaria", () => {
    expect(initials("Albertazzi Vittorio")).toBe("AV");
    expect(initials("Nautica Ionio S.r.l.")).toBe("NI");
    expect(initials("De Luca")).toBe("DL");
    expect(initials("Rossi")).toBe("R");
  });
});

describe("boatModelLabel", () => {
  it("mostra cantiere e modello solo se aggiungono qualcosa al nome", () => {
    expect(boatModelLabel({ name: "Stella", builder: "SACS", model: "S 490" })).toBe("SACS S 490");
    expect(boatModelLabel({ name: "SACS S 490", builder: "SACS", model: "S 490" })).toBeNull();
    expect(boatModelLabel({ name: "Stella", builder: null, model: null })).toBeNull();
  });
});
