import { describe, expect, it } from "vitest";
import { isValidFiscalCode, isValidVatNumber, splitNameByFiscalCode, splitNameGuess } from "../src/lib/fiscal";
import {
  checkRow,
  cleanRow,
  extractRawRows,
  findHeaderRow,
  groupRows,
  guessMapping,
  ownerKey,
  sameBoat,
  sheetColumns,
  splitPhones,
  titleCase,
  type ImportRow,
} from "../src/lib/owner-import";
import { provinceCode } from "../src/lib/provinces";
import type { Sheet } from "../src/lib/xlsx";

// Dati di fantasia (codici fiscali e partite IVA di prova, con il carattere di controllo giusto).
const CF_ROSSI = "RSSMRA85T10A562S";
const CF_DE_SANTIS = "DSNNMR80A41H501H"; // De Santis Anna Maria
const CF_BIANCHI = "BNCLRA90A41H501F";
const PIVA = "00123456782";

describe("codice fiscale e partita IVA", () => {
  it("controllo del carattere finale", () => {
    expect(isValidFiscalCode(CF_ROSSI)).toBe(true);
    expect(isValidFiscalCode("RSSMRA85T10A562T")).toBe(false);
    expect(isValidVatNumber(PIVA)).toBe(true);
    expect(isValidVatNumber("00123456781")).toBe(false);
  });
  it("cognome e nome divisi con il codice fiscale, anche se composti", () => {
    expect(splitNameByFiscalCode("ROSSI MARIO", CF_ROSSI)).toEqual({ lastName: "ROSSI", firstName: "MARIO" });
    expect(splitNameByFiscalCode("DE SANTIS ANNA MARIA", CF_DE_SANTIS)).toEqual({ lastName: "DE SANTIS", firstName: "ANNA MARIA" });
    expect(splitNameByFiscalCode("ROSSI MARIO", null)).toBeNull();
  });
  it("senza codice fiscale: la prima parola è il cognome, con le particelle", () => {
    expect(splitNameGuess("VERDI GIUSEPPE")).toEqual({ lastName: "VERDI", firstName: "GIUSEPPE" });
    expect(splitNameGuess("DI GIULIO LUCA")).toEqual({ lastName: "DI GIULIO", firstName: "LUCA" });
  });
  it("provincia per esteso o sigla", () => {
    expect(provinceCode("ROMA")).toBe("RM");
    expect(provinceCode("l'aquila")).toBe("AQ");
    expect(provinceCode("te")).toBe("TE");
    expect(provinceCode("Atlantide")).toBeNull();
  });
});

// Un foglio come quelli tenuti a mano dai porti: «cognome» con nome e cognome insieme, una colonna senza
// intestazione per la compagnia assicurativa, misure in centimetri (qualcuna in metri), motore e motore ausiliario.
const sheet: Sheet = {
  name: "dati",
  rows: [
    {
      row: 1,
      cells: [
        "rep.", "anno", " posto barca", "cognome", "data di nascita", "indirizzo", "città di residenza", "CAP", "provincia", "telefono",
        "codice fiscale / partita iva", "e mail", "CODICE IDENTIFICATIVO", "cantiere", "categoria", "modello", "tipo", "naz.",
        "nominativo imbarcazione", "lunghezza f.t.", "larghezza f.t.", "pescaggio", "motorizzazione", "marca", "numero", "potenza hp",
        "motorizzazione ausiliaria", "marca", "numero", "potenza hp", null, "n° polizza",
      ],
    },
    {
      row: 2,
      cells: [
        710, 2026, 19, "ROSSI MARIO", 31391, "VIA ROMA 4", "ROSETO DEGLI ABRUZZI", 64026, "TE", "3391234567 3391234568",
        CF_ROSSI, "mario.rossi@example.com", "000000", "JEANNEAU", "VELA", "SUN ODYSSEY 32", "VELA", "ITA",
        "", 950, 300, 145, "EB", "VOLVO PENTA", 1, 20, "F", "YAMAHA", 1, 9.9, "ASSICURA SPA", "P-123",
      ],
    },
    {
      row: 3,
      cells: [711, 2026, 20, "DE SANTIS ANNA MARIA", null, "VIA MARE 1", "ROMA", "00100", "ROMA", "3401111111", CF_DE_SANTIS, "anna@@example", "", "SACS", "MOTORE", "S 490", "GOMMONE", "ITA", "", 4.9, 1.8, 0.4],
    },
    // stesso cliente della riga 2, seconda barca
    { row: 4, cells: [712, 2026, 21, "ROSSI MARIO", null, null, null, null, null, "3391234567 - 3209999999", CF_ROSSI, "mario@altro.example", null, "CAPELLI", "MOTORE", "TEMPEST 600", "OPEN", "ITA", "ALBA", 600, 240, 40] },
    { row: 5, cells: [713, 2026, 22, "CIRCOLO VELICO ESEMPIO", null, "PIAZZA PORTO 2", "PESCARA", 65100, "PE", "085123456", "123456782", "info@circolo.example", "M5UXCR1"] },
    { row: 6, cells: [] },
    { row: 7, cells: [null, null, null, null, null, null, null, null, null, null, null, null, null, "CANTIERE SOLO"] },
  ],
};

describe("lettura del foglio", () => {
  const headerIdx = findHeaderRow(sheet);
  const columns = sheetColumns(sheet, headerIdx);
  const mapping = guessMapping(columns);
  const field = (header: string, nth = 0) => mapping[columns.filter((c) => c.header === header)[nth].index];

  it("trova l'intestazione e riconosce le colonne", () => {
    expect(headerIdx).toBe(0);
    expect(field("cognome")).toBe("fullName"); // contiene cognome e nome insieme
    expect(field("codice fiscale / partita iva")).toBe("fiscalId");
    expect(field("CODICE IDENTIFICATIVO")).toBe("sdiCode");
    expect(field("naz.")).toBe("flag");
    expect(field("nominativo imbarcazione")).toBe("boatName");
    expect(field("marca", 0)).toBe("engineBrand");
    expect(field("marca", 1)).toBe("auxEngineBrand");
    expect(field("numero", 1)).toBe("auxEngineCount");
    expect(field("rep.")).toBeNull();
    expect(field("anno")).toBeNull(); // l'anno del contratto non è l'anno di costruzione
    expect(mapping[columns.find((c) => c.letter === "AE")!.index]).toBe("insuranceCompany"); // senza intestazione, prima della polizza
  });

  it("legge le righe con dati e salta quelle vuote", () => {
    const rows = extractRawRows(sheet, headerIdx, mapping);
    expect(rows.map((r) => r.row)).toEqual([2, 3, 4, 5, 7]);
  });

  it("pulisce i dati e annota le correzioni", () => {
    const rows = extractRawRows(sheet, headerIdx, mapping).map((r) => cleanRow(r, { titleCase: true, date1904: false }, "2026-11-16"));
    const [rossi, deSantis, , circolo, soloCantiere] = rows;

    expect(rossi.owner).toMatchObject({ type: "persona", lastName: "Rossi", firstName: "Mario", fiscalCode: CF_ROSSI, birthDate: "1985-12-10" });
    expect(rossi.owner).toMatchObject({ city: "Roseto Degli Abruzzi", zip: "64026", province: "TE", sdiCode: "0000000", phone: "3391234567 / 3391234568" });
    expect(rossi.boat).toMatchObject({ type: "vela", builder: "JEANNEAU", lengthCm: 950, beamCm: 300, draftCm: 145, name: "JEANNEAU SUN ODYSSEY 32" });
    expect(rossi.boat).toMatchObject({ engineType: "entrobordo", engineBrand: "VOLVO PENTA", engineCount: 1, enginePowerHp: 20, auxEngineType: "fuoribordo", auxEnginePowerHp: 10 });
    expect(rossi.boat).toMatchObject({ insuranceCompany: "ASSICURA SPA", insurancePolicy: "P-123" });

    expect(deSantis.owner).toMatchObject({ lastName: "De Santis", firstName: "Anna Maria", province: "RM", email: "" });
    expect(deSantis.fixes.join(" ")).toMatch(/Email non valida/);
    expect(deSantis.boat).toMatchObject({ type: "gommone", lengthCm: 490, beamCm: 180, draftCm: 40 });
    expect(deSantis.fixes.join(" ")).toMatch(/Lunghezza scritta in metri/);

    expect(circolo.owner).toMatchObject({ type: "azienda", companyName: "CIRCOLO VELICO ESEMPIO", vatNumber: PIVA, zip: "65100" });
    expect(circolo.fixes.join(" ")).toMatch(/zeri iniziali/);
    expect(circolo.boat).toBeNull();

    // Una riga senza nome si blocca.
    expect(checkRow(soloCantiere).some((i) => i.level === "blocca")).toBe(true);
    expect(checkRow(rossi).filter((i) => i.level === "blocca")).toEqual([]);
  });

  it("raggruppa le righe dello stesso cliente: un cliente, due barche", () => {
    const rows = extractRawRows(sheet, headerIdx, mapping).map((r) => cleanRow(r, { titleCase: true, date1904: false }, "2026-11-16"));
    const groups = groupRows(rows);
    const rossi = groups.find((g) => g.key === `CF:${CF_ROSSI}`)!;
    expect(rossi.rows).toEqual([2, 4]);
    expect(rossi.boats.map((b) => b.boat.name)).toEqual(["JEANNEAU SUN ODYSSEY 32", "ALBA"]);
    expect(rossi.owner.address).toBe("Via Roma 4"); // dalla prima riga
    // I telefoni delle due righe si sommano senza ripetere quelli già presenti; l'email diversa si segnala.
    expect(rossi.owner.phone).toBe("3391234567 / 3391234568 / 3209999999");
    expect(rossi.conflicts.join(" ")).toMatch(/email «mario@altro.example»/);
    expect(rossi.conflicts.join(" ")).not.toMatch(/telefono/);
    // La riga senza nome non forma un cliente; escludere una riga la toglie dal gruppo.
    expect(groups).toHaveLength(3);
    const excluded: ImportRow[] = rows.map((r) => (r.row === 4 ? { ...r, excluded: true } : r));
    expect(groupRows(excluded).find((g) => g.key === `CF:${CF_ROSSI}`)!.boats).toHaveLength(1);
  });
});

describe("piccole regole", () => {
  it("telefoni nella stessa cella", () => {
    expect(splitPhones("3391234567 3391234568")).toEqual(["3391234567", "3391234568"]);
    expect(splitPhones("3391234567 - 085 1234567")).toEqual(["3391234567", "085 1234567"]);
    expect(splitPhones("3391234567-085123456")).toEqual(["3391234567", "085123456"]);
    expect(splitPhones("085 1234567")).toEqual(["085 1234567"]);
  });
  it("maiuscole e chiavi dei clienti", () => {
    expect(titleCase("D'ANGELO MARCO")).toBe("D'Angelo Marco");
    expect(titleCase("Già Scritto")).toBe("Già Scritto");
    const base = { type: "persona" as const, firstName: "Mario", lastName: "Rossi", companyName: "", fiscalCode: "", vatNumber: "", birthDate: "" };
    expect(ownerKey({ ...base, fiscalCode: CF_BIANCHI } as never)).toBe(`CF:${CF_BIANCHI}`);
    expect(ownerKey(base as never)).toBe("NOME:rossimario");
  });
  it("stessa barca", () => {
    expect(sameBoat({ name: "Alba", registration: "", lengthCm: 600 }, { name: "ALBA", registration: "", lengthCm: 600 })).toBe(true);
    expect(sameBoat({ name: "Alba", registration: "RM1234", lengthCm: 600 }, { name: "Alba", registration: "RM9999", lengthCm: 600 })).toBe(false);
  });
});
