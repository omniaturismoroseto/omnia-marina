import { describe, expect, it } from "vitest";
import { checkRows, extractLedgerRows, reviewRows, sheetCashBalance, toLedgerEntries, type DraftRow, type SourceRow } from "../src/lib/ledger-import";
import { columnIndex, excelSerialToISO, readXlsx, XlsxError } from "../src/lib/xlsx";

// ───── Costruzione di un piccolo .xlsx in memoria (ZIP con file XML) ─────

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zip(files: Record<string, string>): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  let i = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(content);
    // Un file compresso e gli altri no, per provare entrambi i casi.
    const method = i++ % 2 === 0 ? 8 : 0;
    const data = method === 8 ? await deflateRaw(raw) : raw;
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

type Cell = string | number | null;
const colName = (i: number) => String.fromCharCode(65 + i);

function sheetXml(rows: Cell[][], strings: string[]): string {
  const body = rows
    .map((cells, r) => {
      const cs = cells
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (v === null) return "";
          if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
          if (v.startsWith("=")) return `<c r="${ref}" t="str"><f>${v.slice(1)}</f><v>calcolato</v></c>`;
          let idx = strings.indexOf(v);
          if (idx < 0) idx = strings.push(v) - 1;
          return `<c r="${ref}" s="1" t="s"><v>${idx}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join("");
  return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}

async function workbook(sheets: Record<string, Cell[][]>): Promise<Uint8Array> {
  const strings: string[] = [];
  const files: Record<string, string> = {};
  const names = Object.keys(sheets);
  names.forEach((name, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[name], strings)));
  files["xl/workbook.xml"] = `<workbook><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  files["xl/_rels/workbook.xml.rels"] = `<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  files["xl/sharedStrings.xml"] = `<sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`;
  return zip(files);
}

const HEADER: Cell[] = ["Data operazione", "Causale", "pagamento", "note", "n.", "anno", "Cliente", "Fornitore", "Entrate  uscite", "banca", "cassa"];
// Numeri di serie di Excel: 46023 = 01/01/2026.
const d = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000);

const row = (over: Partial<DraftRow> & { row: number }): DraftRow => ({
  date: "2026-05-10",
  causale: "ORMEGGIO",
  method: "",
  note: "",
  receipt: "",
  year: "",
  name: "",
  amountCents: null,
  bankCents: null,
  excluded: false,
  ...over,
});

describe("lettura di un file Excel", () => {
  it("colonne e date di Excel", () => {
    expect(columnIndex("A6")).toBe(0);
    expect(columnIndex("K1")).toBe(10);
    expect(columnIndex("AA3")).toBe(26);
    expect(excelSerialToISO(46023)).toBe("2026-01-01");
    expect(excelSerialToISO(d("2026-11-05"))).toBe("2026-11-05");
  });

  it("legge fogli, testi condivisi e valori, e sceglie il foglio della prima nota", async () => {
    const file = await workbook({
      Foglio1: [["SOSPESO CATTAFESSA", -34.57]],
      primanota: [
        ['="Prima Nota"'],
        [],
        HEADER,
        [d("2026-01-01"), "CASSA", null, null, null, null, "CASSA 2025", null, 4108.33, null, "=SUM(I4)"],
        [d("2026-01-16"), "ORMEGGIO", "BONIFICO", "SALDO", 1, 2026, "FRANCHI & C. <srl>", null, 2940, 2940],
        [d("2026-01-17"), "FATTURA", null, null, null, null, "COMMAGRIV", null, -328, "  "],
        [null, null, null, null, null, null, null, null, null, 1480],
      ],
    });
    const wb = await readXlsx(file);
    expect(wb.sheets.map((s) => s.name)).toEqual(["Foglio1", "primanota"]);
    const ex = extractLedgerRows(wb);
    expect(ex.sheetName).toBe("primanota");
    expect(ex.ignoredRows).toEqual([7]);
    expect(ex.rows).toHaveLength(3);
    expect(ex.rows[1]).toMatchObject({ row: 5, date: "2026-01-16", method: "BONIFICO", receipt: "1", year: "2026", name: "FRANCHI & C. <srl>", amountCents: 294000, bankCents: 294000 });
    expect(ex.rows[2]).toMatchObject({ amountCents: -32800, bankCents: null });
  });

  it("rifiuta file che non sono Excel o senza prima nota", async () => {
    await expect(readXlsx(new TextEncoder().encode("non sono un excel"))).rejects.toBeInstanceOf(XlsxError);
    const wb = await readXlsx(await workbook({ Dati: [["Nome", "Cognome"]] }));
    expect(() => extractLedgerRows(wb)).toThrow(/Data operazione/);
  });
});

describe("controlli e correzioni dell'anteprima", () => {
  const rows: SourceRow[] = [
    row({ row: 6, date: "2026-01-01", causale: "CASSA", name: "CASSA 2025", amountCents: 410833 }),
    row({ row: 7, date: "2025-01-02", causale: "BANCA", name: "BANCA", year: "2025", bankCents: 285000 }),
    row({ row: 8, date: "2026-01-16", method: "BONIFICO", amountCents: 100000 }),
    row({ row: 9, date: "2026-11-26", causale: "CARBURANTE", name: "CARBURANTE", amountCents: 49200 }),
    row({ row: 10, date: "2026-01-27", causale: "CARBURANTE", name: "CARBURANTE POS", amountCents: 5000 }),
    row({ row: 11, date: "2026-01-28", causale: "ORMEGGIO", name: "CORTI", method: "BONIFICO" }),
    row({ row: 12, date: "2026-01-29", causale: "CARBURANTE", name: "PAG ANTARES BONIFICO", bankCents: 118494 }),
  ];
  const reviewed = reviewRows(rows);
  const by = (n: number) => reviewed.find((r) => r.original.row === n)!;

  it("corregge da sola solo le date, senza toccare gli importi", () => {
    expect(by(7).proposed.date).toBe("2026-01-02");
    expect(by(7).fixes[0]).toMatch(/Anno 2025 corretto in 2026/);
    expect(by(9).proposed.date).toBe("2026-01-26");
    expect(by(9).fixes[0]).toMatch(/fuori sequenza/);
    for (const r of reviewed) {
      expect(r.proposed.amountCents).toBe(r.original.amountCents);
      expect(r.proposed.bankCents).toBe(r.original.bankCents);
    }
  });

  it("propone le correzioni degli importi ed esclude le righe vuote", () => {
    expect(by(8).suggestions.map((s) => s.patch)).toEqual([{ bankCents: 100000 }]);
    expect(by(10).suggestions.map((s) => s.patch)).toEqual([{ amountCents: -5000 }]);
    expect(by(12).suggestions.map((s) => s.patch)).toEqual([{ amountCents: 118494 }]);
    expect(by(11).proposed.excluded).toBe(true);
  });

  it("blocca le righe incluse senza data o importo, avvisa sulle altre anomalie", () => {
    const drafts = reviewed.map((r) => r.proposed);
    const issues = checkRows(drafts, "2026-11-15");
    expect(issues.get(8)?.[0].message).toMatch(/colonna banca è vuota/);
    expect(issues.get(10)?.[0].message).toMatch(/negativa/);
    expect(issues.has(11)).toBe(false); // esclusa
    const withEmpty = drafts.map((x) => (x.row === 11 ? { ...x, excluded: false } : x));
    expect(checkRows(withEmpty, "2026-11-15").get(11)?.[0].level).toBe("blocca");
    const future = checkRows([row({ row: 1, date: "2026-12-01", amountCents: 100 })], "2026-11-15");
    expect(future.get(1)?.[0].message).toMatch(/futuro/);
    const dup = checkRows([row({ row: 1, receipt: "5", amountCents: 100 }), row({ row: 2, receipt: "5", amountCents: 200 })], "2026-11-15");
    expect(dup.get(2)?.[0].message).toMatch(/Ricevuta n. 5 ripetuta/);
  });
});

describe("conversione in movimenti di prima nota", () => {
  it("cassa e banca come nel foglio, giroconti e carburante a giornata", () => {
    const drafts: DraftRow[] = [
      row({ row: 1, date: "2026-01-01", causale: "CASSA", name: "CASSA 2025", amountCents: 400000 }),
      row({ row: 2, date: "2026-01-02", causale: "BANCA", name: "BANCA", bankCents: 100000 }),
      row({ row: 3, causale: "ORMEGGIO", method: "BONIFICO", note: "SALDO", year: "2026", receipt: "1", name: "FRANCHI", amountCents: 294000, bankCents: 294000 }),
      row({ row: 4, causale: "ORMEGGIO", method: "ASSEGNO", note: "ACCONTO", receipt: "2", name: "ZITTI", amountCents: 50000 }),
      row({ row: 5, causale: "ORMEGGIO", method: "CO+BONIF", receipt: "3", name: "SCOTTI", amountCents: 242000, bankCents: 140000 }),
      row({ row: 6, causale: "FATTURA", name: "COMMAGRIV", amountCents: -32800 }),
      row({ row: 7, causale: "CARBURANTE", name: "CARBURANTE", amountCents: 134200 }),
      row({ row: 8, causale: "CARBURANTE", name: "SOSPESO CATTAFESSA", amountCents: -3457 }),
      row({ row: 9, causale: "CARBURANTE", name: "USO INTERNO", amountCents: -29000 }),
      row({ row: 10, causale: "CARBURANTE", name: "CARBURANTE POS", amountCents: -97800 }),
      row({ row: 11, causale: "CARBURANTE", method: "POS", name: "PAG SOSPESO FERRETTI", amountCents: 7000, bankCents: 7000 }),
      row({ row: 12, causale: "ORMEGGIO", name: "ESCLUSA", amountCents: 999900, excluded: true }),
    ];
    const entries = toLedgerEntries(drafts);
    const balance = (account: "cassa" | "banca") => entries.filter((e) => e.account === account).reduce((s, e) => s + (e.direction === "entrata" ? e.amountCents : -e.amountCents), 0);

    // Il saldo di cassa resta quello calcolato dal foglio.
    expect(balance("cassa")).toBe(sheetCashBalance(drafts));
    expect(balance("cassa")).toBe(400000 - 100000 + 50000 + 102000 - 32800 + (134200 - 3457 - 29000 - 97800));
    expect(balance("banca")).toBe(100000 + 294000 + 140000 + 97800 + 7000);

    expect(entries.filter((e) => e.category === "Giroconto").map((e) => [e.account, e.direction])).toEqual([
      ["cassa", "uscita"],
      ["banca", "entrata"],
    ]);
    expect(entries.find((e) => e.category === "Saldo iniziale")).toMatchObject({ account: "cassa", amountCents: 400000 });
    expect(entries.find((e) => e.documentRef === "Ricevuta n. 1")).toMatchObject({ account: "banca", category: "Ormeggi", counterparty: "FRANCHI", description: "Ormeggio, saldo 2026 (bonifico)" });
    expect(entries.find((e) => e.documentRef === "Ricevuta n. 2")).toMatchObject({ account: "cassa", description: "Ormeggio, acconto (assegno)" });
    expect(entries.find((e) => e.counterparty === "COMMAGRIV")).toMatchObject({ direction: "uscita", category: "Forniture", amountCents: 32800 });

    const fuel = entries.filter((e) => e.description.startsWith("Carburante del giorno"));
    expect(fuel.map((e) => [e.account, e.amountCents])).toEqual([
      ["cassa", 134200 - 3457 - 29000 - 97800],
      ["banca", 97800],
    ]);
    expect(fuel[0].description).toMatch(/sospesi CATTAFESSA 34,57/);
    expect(entries.find((e) => e.description.includes("PAG SOSPESO FERRETTI"))).toMatchObject({ account: "banca", category: "Carburante", counterparty: null });
    expect(entries.some((e) => e.counterparty === "ESCLUSA")).toBe(false);
  });
});
