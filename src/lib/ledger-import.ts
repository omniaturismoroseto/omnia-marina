// Importazione di una prima nota tenuta in Excel: lettura delle righe, controlli, correzioni proposte
// e conversione nei movimenti di prima nota dell'app. Funzioni pure, usate sia dall'anteprima nel
// browser sia dall'azione server che ripete i controlli prima di salvare.
//
// Il foglio di partenza ragiona solo sulla cassa: "Entrate uscite" è l'importo con il segno e "banca"
// è la parte che non passa dalla cassa (bonifici, POS). Il saldo di cassa è somma(importi) − somma(banca).
// Le righe "BANCA" con la sola colonna banca sono contanti versati in banca. Il carburante si registra a
// giornata: venduto, meno POS, sospesi (venduto non ancora pagato) e uso interno.

import { addDays, diffDays, isValidISODate } from "./dates";
import { formatMoney } from "./format";
import { excelSerialToISO, XlsxError, type CellValue, type Workbook } from "./xlsx";

export interface SourceRow {
  row: number; // numero di riga in Excel
  date: string | null;
  causale: string;
  method: string;
  note: string;
  receipt: string;
  year: string;
  name: string;
  amountCents: number | null; // con segno: positivo entrata, negativo uscita
  bankCents: number | null;
}

export interface DraftRow extends SourceRow {
  excluded: boolean;
}

export interface Suggestion {
  label: string;
  patch: Partial<SourceRow>;
}

export interface ReviewedRow {
  original: SourceRow;
  proposed: DraftRow;
  fixes: string[]; // correzioni già applicate alla proposta (solo date: non cambiano i saldi)
  suggestions: Suggestion[]; // correzioni che cambiano gli importi: le applica l'utente
}

export interface Issue {
  level: "blocca" | "avviso";
  message: string;
}

export interface LedgerDraft {
  entryDate: string;
  direction: "entrata" | "uscita";
  account: "cassa" | "banca";
  amountCents: number;
  category: string;
  description: string;
  counterparty: string | null;
  documentRef: string | null;
}

// Tiene il carico inviato al server sotto il limite di 1 MB delle azioni server.
export const MAX_IMPORT_ROWS = 4000;

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");
const clean = (v: CellValue): string => (v === null || v === undefined ? "" : String(v).trim().replace(/\s+/g, " "));

// ───────────────────────── Lettura del foglio ─────────────────────────

type Column = "date" | "causale" | "method" | "note" | "receipt" | "year" | "client" | "supplier" | "amount" | "bank";

function headerColumn(text: string): Column | null {
  const h = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (h.startsWith("data")) return "date";
  if (h.startsWith("causale")) return "causale";
  if (h.startsWith("pagamento") || h === "metodo") return "method";
  if (h.startsWith("note")) return "note";
  if (h === "n." || h === "n" || h === "n°" || h.startsWith("numero") || h.startsWith("ricevuta")) return "receipt";
  if (h === "anno") return "year";
  if (h.startsWith("cliente")) return "client";
  if (h.startsWith("fornitore")) return "supplier";
  if (h.startsWith("entrate") || h.startsWith("importo")) return "amount";
  if (h === "banca") return "bank";
  return null;
}

function toCents(v: CellValue): { cents: number | null; invalid: boolean } {
  if (v === null || v === "" || typeof v === "boolean") return { cents: null, invalid: false };
  if (typeof v === "number") return { cents: Math.round(v * 100), invalid: false };
  let s = v.replace(/[€\s]/g, "");
  if (s === "") return { cents: null, invalid: false };
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { cents: null, invalid: true };
  return { cents: Math.round(Number(s) * 100), invalid: false };
}

function toDate(v: CellValue, date1904: boolean): string | null {
  if (typeof v === "number") return excelSerialToISO(v, date1904);
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isValidISODate(iso) ? iso : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m && isValidISODate(m[0]) ? m[0] : null;
}

export interface Extracted {
  sheetName: string;
  rows: SourceRow[];
  // Righe senza data né causale (totali, appunti): non vengono importate.
  ignoredRows: number[];
  // Valori non numerici trovati nelle colonne degli importi.
  invalidCells: { row: number; column: "importo" | "banca"; value: string }[];
}

// Sceglie il foglio della prima nota (quello con l'intestazione "Data operazione"), preferendo un nome
// che contenga "prima nota", e ne legge le righe.
export function extractLedgerRows(workbook: Workbook): Extracted {
  const candidates = workbook.sheets
    .map((sheet) => {
      const headerIdx = sheet.rows.findIndex((r) => r.cells.some((c) => typeof c === "string" && /^data\s+operazione/i.test(c.trim())));
      return { sheet, headerIdx };
    })
    .filter((c) => c.headerIdx >= 0);
  if (candidates.length === 0) {
    throw new XlsxError("Non trovo la prima nota: serve un foglio con l'intestazione \"Data operazione\" e le colonne \"Entrate uscite\" e \"banca\".");
  }
  const chosen = candidates.find((c) => /prima\s*nota/i.test(c.sheet.name)) ?? candidates[0];
  const header = chosen.sheet.rows[chosen.headerIdx].cells;
  const col = new Map<Column, number>();
  header.forEach((c, i) => {
    const key = typeof c === "string" ? headerColumn(c) : null;
    if (key && !col.has(key)) col.set(key, i);
  });
  for (const [key, label] of [
    ["date", "Data operazione"],
    ["causale", "Causale"],
    ["amount", "Entrate uscite"],
  ] as const) {
    if (!col.has(key)) throw new XlsxError(`Nel foglio "${chosen.sheet.name}" manca la colonna "${label}".`);
  }

  const rows: SourceRow[] = [];
  const ignoredRows: number[] = [];
  const invalidCells: Extracted["invalidCells"] = [];
  for (const r of chosen.sheet.rows.slice(chosen.headerIdx + 1)) {
    const get = (key: Column): CellValue => {
      const i = col.get(key);
      return i === undefined ? null : (r.cells[i] ?? null);
    };
    const used = ["date", "causale", "method", "note", "receipt", "year", "client", "supplier", "amount", "bank"] as const;
    if (used.every((k) => clean(get(k)) === "")) continue;
    const rawDate = get("date");
    if (clean(rawDate) === "" && clean(get("causale")) === "" && clean(get("client")) === "" && clean(get("supplier")) === "") {
      ignoredRows.push(r.row);
      continue;
    }
    const amount = toCents(get("amount"));
    const bank = toCents(get("bank"));
    if (amount.invalid) invalidCells.push({ row: r.row, column: "importo", value: clean(get("amount")) });
    if (bank.invalid) invalidCells.push({ row: r.row, column: "banca", value: clean(get("bank")) });
    const receipt = get("receipt");
    rows.push({
      row: r.row,
      date: toDate(rawDate, workbook.date1904),
      causale: clean(get("causale")),
      method: clean(get("method")),
      note: clean(get("note")),
      receipt: typeof receipt === "number" ? String(Math.round(receipt)) : clean(receipt),
      year: clean(get("year")),
      name: clean(get("client")) || clean(get("supplier")),
      amountCents: amount.cents,
      bankCents: bank.cents,
    });
  }
  if (rows.length > MAX_IMPORT_ROWS) throw new XlsxError(`Il foglio ha ${rows.length} righe: se ne possono importare al massimo ${MAX_IMPORT_ROWS} per volta.`);
  return { sheetName: chosen.sheet.name, rows, ignoredRows, invalidCells };
}

// ───────────────────────── Classificazione ─────────────────────────

export type FuelPart = "venduto" | "pos" | "sospeso" | "interno";

// Versamento di contanti in banca: causale BANCA con la sola colonna banca.
export function isTransfer(r: SourceRow): boolean {
  return norm(r.causale) === "BANCA" && !r.amountCents && (r.bankCents ?? 0) !== 0;
}

// Voci della chiusura giornaliera del carburante.
export function fuelPart(r: SourceRow): FuelPart | null {
  if (norm(r.causale) !== "CARBURANTE" || r.bankCents || r.receipt) return null;
  const n = norm(r.name);
  if (n === "CARBURANTE") return "venduto";
  if (n === "CARBURANTE POS") return "pos";
  if (/^SOSPESO\b/.test(n)) return "sospeso";
  if (n === "USO INTERNO") return "interno";
  return null;
}

const isElectronic = (method: string) => {
  const m = norm(method);
  return (m.startsWith("BONIFICO") || m.startsWith("POS")) && !m.includes("+");
};
const isCashMethod = (method: string) => {
  const m = norm(method);
  return m.startsWith("CONTANT") || m.startsWith("ASSEGN");
};

// ───────────────────────── Controlli e correzioni ─────────────────────────

function mostCommonYear(rows: SourceRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.date) counts.set(r.date.slice(0, 4), (counts.get(r.date.slice(0, 4)) ?? 0) + 1);
  let best: string | null = null;
  for (const [y, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = y;
  return best;
}

// Date delle righe vicine diverse da quella della riga: la più vicina prima e la più vicina dopo.
function neighbours(dates: (string | null)[], i: number): { prev: string | null; next: string | null } {
  const own = dates[i];
  let prev: string | null = null;
  let next: string | null = null;
  for (let j = i - 1; j >= 0; j--) if (dates[j] && dates[j] !== own) { prev = dates[j]; break; }
  for (let j = i + 1; j < dates.length; j++) if (dates[j] && dates[j] !== own) { next = dates[j]; break; }
  return { prev, next };
}

const TOLERANCE_DAYS = 15;

// true se la data è molto lontana da quelle delle righe vicine (il foglio è in ordine di data).
function outOfSequence(date: string, prev: string | null, next: string | null): boolean {
  const near = [prev, next].filter((d): d is string => d !== null).sort();
  if (near.length === 0) return false;
  return date < addDays(near[0], -TOLERANCE_DAYS) || date > addDays(near[near.length - 1], TOLERANCE_DAYS);
}

const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// Prepara l'anteprima: corregge le date sbagliate in modo evidente (anno diverso da quello del foglio,
// mese sbagliato rispetto alle righe vicine) e propone, senza applicarle, le correzioni degli importi.
export function reviewRows(rows: SourceRow[]): ReviewedRow[] {
  const year = mostCommonYear(rows);
  const reviewed: ReviewedRow[] = rows.map((r) => ({
    original: r,
    proposed: { ...r, excluded: r.amountCents === null && r.bankCents === null },
    fixes: [],
    suggestions: [],
  }));

  for (const it of reviewed) {
    const d = it.proposed.date;
    if (d && year && d.slice(0, 4) !== year) {
      const fixed = `${year}${d.slice(4)}`;
      if (isValidISODate(fixed)) {
        it.proposed.date = fixed;
        it.fixes.push(`Anno ${d.slice(0, 4)} corretto in ${year}`);
      }
    }
  }

  const dates = reviewed.map((it) => it.proposed.date);
  reviewed.forEach((it, i) => {
    const d = it.proposed.date;
    if (!d) return;
    const { prev, next } = neighbours(dates, i);
    if (!outOfSequence(d, prev, next)) return;
    const lo = [prev, next].filter((x): x is string => x !== null).sort()[0];
    const hi = [prev, next].filter((x): x is string => x !== null).sort().at(-1)!;
    for (const ref of [prev, next]) {
      if (!ref) continue;
      const candidate = `${ref.slice(0, 7)}${d.slice(7)}`;
      if (isValidISODate(candidate) && candidate >= lo && candidate <= hi) {
        it.proposed.date = candidate;
        dates[i] = candidate;
        it.fixes.push(`Data ${fmtDate(d)} corretta in ${fmtDate(candidate)} (fuori sequenza)`);
        break;
      }
    }
  });

  for (const it of reviewed) {
    const r = it.proposed;
    const part = fuelPart(r);
    if ((part === "pos" || part === "sospeso" || part === "interno") && (r.amountCents ?? 0) > 0) {
      it.suggestions.push({ label: `Rendi negativo (−${formatMoney(r.amountCents)})`, patch: { amountCents: -(r.amountCents ?? 0) } });
    }
    if (isElectronic(r.method) && r.amountCents !== null && r.bankCents === null) {
      it.suggestions.push({ label: `Metti ${formatMoney(r.amountCents)} in banca`, patch: { bankCents: r.amountCents } });
    }
    if (isElectronic(r.method) && r.amountCents !== null && r.bankCents !== null && r.amountCents !== r.bankCents) {
      it.suggestions.push({ label: `Banca uguale all'importo (${formatMoney(r.amountCents)})`, patch: { bankCents: r.amountCents } });
      it.suggestions.push({ label: `Importo uguale alla banca (${formatMoney(r.bankCents)})`, patch: { amountCents: r.bankCents } });
    }
    if (r.amountCents === null && r.bankCents !== null && !isTransfer(r)) {
      it.suggestions.push({ label: `Importo uguale alla banca (${formatMoney(r.bankCents)})`, patch: { amountCents: r.bankCents } });
    }
  }
  return reviewed;
}

// Controlli sullo stato attuale delle righe (ripetuti a ogni modifica nell'anteprima e dal server).
export function checkRows(rows: DraftRow[], today: string): Map<number, Issue[]> {
  const result = new Map<number, Issue[]>();
  const add = (row: number, level: Issue["level"], message: string) => {
    const list = result.get(row) ?? [];
    list.push({ level, message });
    result.set(row, list);
  };
  const included = rows.filter((r) => !r.excluded);
  const year = mostCommonYear(included);
  const dates = included.map((r) => r.date);
  const receipts = new Map<string, number[]>();

  included.forEach((r, i) => {
    if (!r.date || !isValidISODate(r.date)) add(r.row, "blocca", "Data mancante o non valida");
    if (r.amountCents === null && r.bankCents === null) add(r.row, "blocca", "Senza importo: inseriscilo o escludi la riga");
    if (r.date && isValidISODate(r.date)) {
      if (r.date > today) add(r.row, "avviso", "Data nel futuro");
      if (year && r.date.slice(0, 4) !== year) add(r.row, "avviso", `Anno diverso dal resto del foglio (${year})`);
      const { prev, next } = neighbours(dates, i);
      if (outOfSequence(r.date, prev, next)) add(r.row, "avviso", "Data lontana da quelle delle righe vicine");
    }
    if (isElectronic(r.method)) {
      if (r.amountCents !== null && r.bankCents === null) add(r.row, "avviso", `${r.method}: la colonna banca è vuota, l'importo viene contato in cassa`);
      else if (r.amountCents !== null && r.bankCents !== null && r.amountCents !== r.bankCents) {
        add(r.row, "avviso", `Importo (${formatMoney(r.amountCents)}) e banca (${formatMoney(r.bankCents)}) diversi`);
      }
    }
    if (isCashMethod(r.method) && r.bankCents) add(r.row, "avviso", `Pagamento in ${r.method.toLowerCase()} con un importo in banca`);
    if (r.amountCents === null && r.bankCents !== null && !isTransfer(r)) {
      add(r.row, "avviso", "C'è solo la colonna banca: la cifra viene tolta dalla cassa e messa in banca");
    }
    const part = fuelPart(r);
    if ((part === "pos" || part === "sospeso" || part === "interno") && (r.amountCents ?? 0) > 0) {
      add(r.row, "avviso", "Di solito questa voce del carburante è negativa");
    }
    if (r.receipt) receipts.set(r.receipt, [...(receipts.get(r.receipt) ?? []), r.row]);
  });

  for (const [receipt, list] of receipts) {
    if (list.length > 1) for (const row of list) add(row, "avviso", `Ricevuta n. ${receipt} ripetuta (righe ${list.join(", ")})`);
  }

  // Possibili doppioni: stessa causale e stesso importo in banca entro un mese, una riga con ricevuta
  // e una senza, almeno una delle due registrata come pagamento ("PAG …").
  const banked = included.filter((r) => (r.bankCents ?? 0) >= 10_000 && r.date);
  for (let a = 0; a < banked.length; a++) {
    for (let b = a + 1; b < banked.length; b++) {
      const x = banked[a];
      const y = banked[b];
      if (x.bankCents !== y.bankCents || Boolean(x.receipt) === Boolean(y.receipt) || norm(x.causale) !== norm(y.causale)) continue;
      if (!/^PAG/.test(norm(x.name)) && !/^PAG/.test(norm(y.name))) continue;
      if (Math.abs(diffDays(x.date!, y.date!)) > 31) continue;
      add(x.row, "avviso", `Possibile doppione della riga ${y.row} (stesso importo in banca)`);
      add(y.row, "avviso", `Possibile doppione della riga ${x.row} (stesso importo in banca)`);
    }
  }
  return result;
}

export function hasBlockingIssues(issues: Map<number, Issue[]>): boolean {
  for (const list of issues.values()) if (list.some((i) => i.level === "blocca")) return true;
  return false;
}

// ───────────────────────── Conversione ─────────────────────────

const ENTRATA_BY_CAUSALE: Record<string, string> = {
  ORMEGGIO: "Ormeggi",
  OREMGGIO: "Ormeggi",
  ORMEGGI: "Ormeggi",
  "ORM+CARB": "Ormeggi",
  ABS: "Servizi",
  SERVIZI: "Servizi",
  CARBURANTE: "Carburante",
  UTENZE: "Utenze",
};
const USCITA_BY_CAUSALE: Record<string, string> = {
  FATTURA: "Forniture",
  FATTURE: "Forniture",
  IMPOSTE: "Imposte e tasse",
  IMPOSTA: "Imposte e tasse",
  TASSE: "Imposte e tasse",
  F24: "Imposte e tasse",
  PERSONALE: "Personale",
  STIPENDI: "Personale",
  MANUTENZIONE: "Manutenzioni",
  MANUTENZIONI: "Manutenzioni",
  UTENZE: "Utenze",
};

function categoryFor(r: SourceRow, direction: "entrata" | "uscita"): string {
  const c = norm(r.causale);
  if (c === "CASSA" && direction === "entrata" && /^(CASSA|SALDO)\b/.test(norm(r.name))) return "Saldo iniziale";
  if (direction === "entrata") return ENTRATA_BY_CAUSALE[c] ?? "Altre entrate";
  return USCITA_BY_CAUSALE[c] ?? "Altre uscite";
}

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

// Nomi che descrivono il movimento invece di indicare chi ha pagato o chi è stato pagato.
const DESCRIPTIVE_NAME = /^(PAG|PAGAMENTO|SOSPESO|PRELIEVO|CARBURANTE|USO INTERNO|CASSA|BANCA|F24)\b/;

function describe(r: SourceRow, account: "cassa" | "banca"): { description: string; counterparty: string | null } {
  const head = sentence(r.causale) || "Movimento";
  const detail = [r.note.toLowerCase(), r.year].filter(Boolean).join(" ");
  let description = detail ? `${head}, ${detail}` : head;
  let counterparty: string | null = r.name || null;
  if (r.name && DESCRIPTIVE_NAME.test(norm(r.name))) {
    description = `${head}: ${r.name}`;
    counterparty = null;
  }
  const method = r.method.toLowerCase();
  if (method && (account === "cassa" ? !isElectronic(r.method) : true)) description += ` (${method})`;
  return { description, counterparty };
}

function pushEntry(out: LedgerDraft[], base: Omit<LedgerDraft, "direction" | "amountCents">, signedCents: number, category?: (d: "entrata" | "uscita") => string) {
  if (signedCents === 0) return;
  const direction = signedCents > 0 ? "entrata" : "uscita";
  out.push({ ...base, direction, amountCents: Math.abs(signedCents), category: category ? category(direction) : base.category });
}

// Converte le righe (già corrette) nei movimenti di prima nota dell'app.
export function toLedgerEntries(rows: DraftRow[]): LedgerDraft[] {
  const out: LedgerDraft[] = [];
  const fuelDays = new Map<string, { venduto: number; pos: number; sospesi: { name: string; cents: number }[]; interno: number }>();

  for (const r of rows) {
    if (r.excluded || !r.date) continue;
    const amount = r.amountCents ?? 0;
    const bank = r.bankCents ?? 0;
    const ref = r.receipt ? `Ricevuta n. ${r.receipt}` : null;

    if (isTransfer(r)) {
      const base = { entryDate: r.date, category: "Giroconto", description: "Versamento di contanti in banca", counterparty: null, documentRef: ref };
      pushEntry(out, { ...base, account: "cassa" }, -bank);
      pushEntry(out, { ...base, account: "banca" }, bank);
      continue;
    }

    const part = fuelPart(r);
    if (part) {
      const day = fuelDays.get(r.date) ?? { venduto: 0, pos: 0, sospesi: [], interno: 0 };
      if (part === "venduto") day.venduto += amount;
      else if (part === "pos") day.pos += amount;
      else if (part === "interno") day.interno += amount;
      else day.sospesi.push({ name: r.name.replace(/^SOSPESO\s+/i, ""), cents: amount });
      fuelDays.set(r.date, day);
      continue;
    }

    const cash = amount - bank;
    const cashText = categoryFor(r, "entrata") === "Saldo iniziale" && cash > 0 ? { description: `Saldo iniziale di cassa (${r.name})`, counterparty: null } : describe(r, "cassa");
    pushEntry(out, { entryDate: r.date, account: "cassa", category: "", documentRef: ref, ...cashText }, cash, (d) => categoryFor(r, d));
    const bankText = describe(r, "banca");
    pushEntry(out, { entryDate: r.date, account: "banca", category: "", documentRef: ref, ...bankText }, bank, (d) => categoryFor(r, d));
  }

  // Chiusura del carburante: in cassa il venduto meno POS, sospesi e uso interno; in banca il POS.
  for (const [date, day] of fuelDays) {
    const sospesi = day.sospesi.reduce((s, x) => s + x.cents, 0);
    const parts = [
      `venduto ${formatMoney(day.venduto)}`,
      day.pos ? `POS ${formatMoney(-day.pos)}` : null,
      day.sospesi.length ? `sospesi ${day.sospesi.map((s) => `${s.name} ${formatMoney(-s.cents)}`).join(", ")}` : null,
      day.interno ? `uso interno ${formatMoney(-day.interno)}` : null,
    ].filter(Boolean);
    const base = { entryDate: date, category: "", counterparty: null, documentRef: null };
    const cat = (d: "entrata" | "uscita") => (d === "entrata" ? "Carburante" : "Altre uscite");
    pushEntry(out, { ...base, account: "cassa", description: `Carburante del giorno: ${parts.join(" · ")}` }, day.venduto + day.pos + sospesi + day.interno, cat);
    pushEntry(out, { ...base, account: "banca", description: "Carburante del giorno, incassi con POS" }, -day.pos, cat);
  }

  return out.sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0));
}

// Saldo di cassa secondo la logica del foglio: somma degli importi meno la colonna banca.
export function sheetCashBalance(rows: DraftRow[]): number {
  return rows.filter((r) => !r.excluded).reduce((s, r) => s + (r.amountCents ?? 0) - (r.bankCents ?? 0), 0);
}
