// Importazione di un elenco di clienti (e delle loro barche) tenuto in Excel: riconoscimento delle colonne,
// lettura delle righe, pulizia e controlli sui dati, raggruppamento dei doppioni. Funzioni pure, usate sia
// dall'anteprima nel browser sia dall'azione server che ripete i controlli prima di salvare.

import { isValidISODate } from "./dates";
import { isValidFiscalCode, isValidVatNumber, splitNameByFiscalCode, splitNameGuess } from "./fiscal";
import { provinceCode } from "./provinces";
import { excelSerialToISO, type CellValue, type Sheet } from "./xlsx";

// Tiene il carico inviato al server sotto il limite delle azioni server.
export const MAX_OWNER_IMPORT_ROWS = 3000;

// ───────────────────────── Campi della scheda ─────────────────────────

export const FIELD_LABEL = {
  fullName: "Cognome e nome (insieme)",
  lastName: "Cognome",
  firstName: "Nome",
  companyName: "Ragione sociale",
  fiscalId: "Codice fiscale o partita IVA",
  fiscalCode: "Codice fiscale",
  vatNumber: "Partita IVA",
  birthDate: "Data di nascita",
  birthPlace: "Luogo di nascita",
  address: "Indirizzo",
  zip: "CAP",
  city: "Comune",
  province: "Provincia",
  country: "Nazione",
  phone: "Telefono",
  email: "Email",
  pec: "PEC",
  sdiCode: "Codice destinatario SDI",
  ownerNotes: "Note sul cliente",
  boatName: "Nome della barca",
  registration: "Iscrizione / matricola",
  boatCategory: "Categoria barca (vela, motore)",
  boatKind: "Tipo di barca (open, gommone…)",
  builder: "Cantiere",
  model: "Modello",
  year: "Anno di costruzione",
  length: "Lunghezza f.t.",
  beam: "Larghezza f.t.",
  draft: "Pescaggio",
  flag: "Bandiera",
  engineType: "Motore: tipo",
  engineBrand: "Motore: marca",
  engineCount: "Motore: numero",
  enginePower: "Motore: potenza (HP)",
  auxEngineType: "Motore ausiliario: tipo",
  auxEngineBrand: "Motore ausiliario: marca",
  auxEngineCount: "Motore ausiliario: numero",
  auxEnginePower: "Motore ausiliario: potenza (HP)",
  declaredValue: "Valore dichiarato (€)",
  insuranceCompany: "Compagnia assicurativa",
  insurancePolicy: "Numero di polizza",
  insuranceExpiry: "Scadenza della polizza",
} as const;

export type FieldKey = keyof typeof FIELD_LABEL;
export const OWNER_FIELDS: FieldKey[] = [
  "fullName", "lastName", "firstName", "companyName", "fiscalId", "fiscalCode", "vatNumber", "birthDate", "birthPlace",
  "address", "zip", "city", "province", "country", "phone", "email", "pec", "sdiCode", "ownerNotes",
];
export const BOAT_FIELDS: FieldKey[] = (Object.keys(FIELD_LABEL) as FieldKey[]).filter((k) => !OWNER_FIELDS.includes(k));

// ───────────────────────── Riconoscimento delle colonne ─────────────────────────

const simplify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const cellText = (v: CellValue): string => (v === null || v === undefined ? "" : typeof v === "number" ? numberText(v) : String(v).trim().replace(/\s+/g, " "));
// I numeri lunghi (telefoni, partite IVA) vanno scritti per intero, senza notazione esponenziale.
const numberText = (n: number) => (Number.isInteger(n) ? BigInt(Math.round(n)).toString() : String(n));

type EngineContext = "main" | "aux" | null;

function headerField(h: string, ctx: EngineContext): { field: FieldKey | null; ctx: EngineContext } {
  const s = simplify(h);
  if (!s) return { field: null, ctx };
  // Barca, prima dei campi del cliente che usano parole simili («nominativo imbarcazione»).
  if (/^(nominativo imbarcazione|nome (della )?(imbarcazione|barca|unita)|imbarcazione|barca|unita)$/.test(s)) return { field: "boatName", ctx };
  if (/(motorizzazione|motore|motori) ausiliar|^ausiliari/.test(s)) return { field: "auxEngineType", ctx: "aux" };
  if (/^(motorizzazione|motore|tipo motore|tipo di motore)$/.test(s)) return { field: "engineType", ctx: "main" };
  if (/^marca/.test(s)) return { field: ctx === "aux" ? "auxEngineBrand" : "engineBrand", ctx };
  if (ctx && /^(numero|n|n motori|numero motori|nr)$/.test(s)) return { field: ctx === "aux" ? "auxEngineCount" : "engineCount", ctx };
  if (/potenza|^(hp|cv|kw)$/.test(s)) return { field: ctx === "aux" ? "auxEnginePower" : "enginePower", ctx };
  if (/^(iscrizione|matricola|targa|numero (di )?iscrizione|n iscrizione)$/.test(s)) return { field: "registration", ctx };
  if (/^(cantiere|costruttore|marca barca)/.test(s)) return { field: "builder", ctx };
  if (/^modello/.test(s)) return { field: "model", ctx };
  if (/^(tipo|tipologia|tipo barca|tipo unita)$/.test(s)) return { field: "boatKind", ctx };
  if (/^(categoria|categoria barca|propulsione)$/.test(s)) return { field: "boatCategory", ctx };
  if (/anno (di )?costruzione/.test(s)) return { field: "year", ctx };
  if (/^(lunghezza|loa|lft|l f t)/.test(s)) return { field: "length", ctx };
  if (/^(larghezza|baglio)/.test(s)) return { field: "beam", ctx };
  if (/^pescaggio/.test(s)) return { field: "draft", ctx };
  if (/^(bandiera|naz|nazionalita|nazionalita barca)$/.test(s)) return { field: "flag", ctx };
  if (/valore (dichiarato|commerciale|assicurato)|^valore$/.test(s)) return { field: "declaredValue", ctx };
  if (/scadenza (della )?(polizza|assicurazione)/.test(s)) return { field: "insuranceExpiry", ctx };
  if (/polizza/.test(s)) return { field: "insurancePolicy", ctx };
  if (/^(assicurazione|compagnia|compagnia assicurativa|assicuratore)$/.test(s)) return { field: "insuranceCompany", ctx };
  // Cliente.
  if (/^(cognome e nome|nome e cognome|nominativo|intestatario|proprietario|cliente|nome cliente|armatore)$/.test(s)) return { field: "fullName", ctx: null };
  if (/^cognome$/.test(s)) return { field: "lastName", ctx: null };
  if (/^nome$/.test(s)) return { field: "firstName", ctx: null };
  if (/ragione sociale|^denominazione|^societa$/.test(s)) return { field: "companyName", ctx: null };
  if (/(codice fiscale|^cf|^c f).*(partita iva|p ?iva)/.test(s)) return { field: "fiscalId", ctx: null };
  if (/^(codice fiscale|cf|c f|cod fiscale|cod fisc)$/.test(s)) return { field: "fiscalCode", ctx: null };
  if (/^(partita iva|p ?iva|p i)$/.test(s)) return { field: "vatNumber", ctx: null };
  if (/data (di )?nascita|^nato il/.test(s)) return { field: "birthDate", ctx: null };
  if (/(luogo|comune|citta) (di )?nascita|^nato a/.test(s)) return { field: "birthPlace", ctx: null };
  if (/^(citta|comune|localita)/.test(s)) return { field: "city", ctx: null };
  if (/^(indirizzo|via|residenza)/.test(s)) return { field: "address", ctx: null };
  if (/^cap$/.test(s)) return { field: "zip", ctx: null };
  if (/^(provincia|prov|pr)$/.test(s)) return { field: "province", ctx: null };
  if (/^(nazione|paese|stato)$/.test(s)) return { field: "country", ctx: null };
  if (/telefono|^tel|cellulare|^cell|recapito/.test(s)) return { field: "phone", ctx: null };
  if (/^pec$/.test(s)) return { field: "pec", ctx: null };
  if (/^(e ?mail|mail|posta elettronica|indirizzo email)$/.test(s)) return { field: "email", ctx: null };
  if (/codice (identificativo|destinatario|univoco)|^sdi|codice sdi/.test(s)) return { field: "sdiCode", ctx: null };
  if (/^note/.test(s)) return { field: "ownerNotes", ctx: null };
  return { field: null, ctx };
}

export interface ColumnInfo {
  index: number; // 0 = colonna A
  letter: string;
  header: string;
  samples: string[];
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** La riga di intestazione: tra le prime 15, quella con più colonne riconosciute (almeno 3). null se il foglio non ne ha. */
export function findHeaderRow(sheet: Sheet): number | null {
  let bestIdx: number | null = null;
  let bestScore = 2;
  sheet.rows.slice(0, 15).forEach((r, idx) => {
    let ctx: EngineContext = null;
    let score = 0;
    for (const c of r.cells) {
      if (typeof c !== "string") continue;
      const g = headerField(c, ctx);
      ctx = g.ctx;
      if (g.field) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

/** Le colonne che contengono dati, con intestazione ed esempi di valori. */
export function sheetColumns(sheet: Sheet, headerIdx: number | null): ColumnInfo[] {
  const header = headerIdx === null ? [] : sheet.rows[headerIdx].cells;
  const data = sheet.rows.slice(headerIdx === null ? 0 : headerIdx + 1);
  const width = Math.max(header.length, ...data.map((r) => r.cells.length), 0);
  const columns: ColumnInfo[] = [];
  for (let i = 0; i < width; i++) {
    const samples: string[] = [];
    let filled = false;
    for (const r of data) {
      const t = cellText(r.cells[i] ?? null);
      if (!t) continue;
      filled = true;
      if (samples.length < 3 && !samples.includes(t)) samples.push(t);
      if (samples.length >= 3) break;
    }
    if (filled) columns.push({ index: i, letter: columnLetter(i), header: cellText(header[i] ?? null), samples });
  }
  return columns;
}

/**
 * Proposta di abbinamento colonna → campo. Ogni campo una volta sola. Due casi tipici dei fogli fatti a mano:
 * - una colonna «cognome» senza colonna «nome» che contiene «COGNOME NOME»: diventa «Cognome e nome»;
 * - una colonna senza intestazione subito prima del numero di polizza: è la compagnia assicurativa.
 */
export function guessMapping(columns: ColumnInfo[]): Record<number, FieldKey | null> {
  const mapping: Record<number, FieldKey | null> = {};
  const used = new Set<FieldKey>();
  let ctx: EngineContext = null;
  for (const col of columns) {
    const g = headerField(col.header, ctx);
    ctx = g.ctx;
    mapping[col.index] = g.field && !used.has(g.field) ? g.field : null;
    if (g.field && mapping[col.index]) used.add(g.field);
  }
  const lastCol = columns.find((c) => mapping[c.index] === "lastName");
  if (lastCol && !used.has("firstName") && !used.has("fullName")) {
    const multiWord = lastCol.samples.filter((s) => s.split(" ").length >= 2).length;
    if (multiWord * 2 >= lastCol.samples.length) mapping[lastCol.index] = "fullName";
  }
  columns.forEach((col, i) => {
    const next = columns[i + 1];
    if (!col.header && mapping[col.index] === null && next && mapping[next.index] === "insurancePolicy" && !used.has("insuranceCompany")) {
      mapping[col.index] = "insuranceCompany";
      used.add("insuranceCompany");
    }
  });
  return mapping;
}

// ───────────────────────── Righe ─────────────────────────

export type RawValues = Partial<Record<FieldKey, CellValue>>;

export interface RawRow {
  row: number; // numero di riga in Excel
  values: RawValues;
}

/** Le righe con dati nelle colonne scelte (le altre si ignorano). */
export function extractRawRows(sheet: Sheet, headerIdx: number | null, mapping: Record<number, FieldKey | null>): RawRow[] {
  const entries = Object.entries(mapping).filter((e): e is [string, FieldKey] => e[1] !== null);
  const rows: RawRow[] = [];
  for (const r of sheet.rows.slice(headerIdx === null ? 0 : headerIdx + 1)) {
    const values: RawValues = {};
    let any = false;
    for (const [index, field] of entries) {
      const v = r.cells[Number(index)] ?? null;
      if (cellText(v) !== "") {
        values[field] = v;
        any = true;
      }
    }
    if (any) rows.push({ row: r.row, values });
  }
  return rows;
}

// ───────────────────────── Pulizia e controlli ─────────────────────────

export interface ImportOwner {
  type: "persona" | "azienda";
  firstName: string;
  lastName: string;
  companyName: string;
  fiscalCode: string;
  vatNumber: string;
  birthDate: string; // AAAA-MM-GG o vuoto
  birthPlace: string;
  address: string;
  zip: string;
  city: string;
  province: string;
  country: string;
  phone: string;
  email: string;
  pec: string;
  sdiCode: string;
  notes: string;
}

export interface ImportBoat {
  name: string;
  registration: string;
  type: "vela" | "motore" | "gommone" | "catamarano" | "altro";
  builder: string;
  model: string;
  year: number | null;
  lengthCm: number | null;
  beamCm: number | null;
  draftCm: number | null;
  flag: string;
  engineType: string;
  engineBrand: string;
  engineCount: number | null;
  enginePowerHp: number | null;
  auxEngineType: string;
  auxEngineBrand: string;
  auxEngineCount: number | null;
  auxEnginePowerHp: number | null;
  declaredValueCents: number | null;
  insuranceCompany: string;
  insurancePolicy: string;
  insuranceExpiry: string;
}

export interface Issue {
  level: "blocca" | "avviso";
  message: string;
}

export interface ImportRow {
  row: number;
  owner: ImportOwner;
  boat: ImportBoat | null;
  excluded: boolean;
}

export interface ReviewedRow extends ImportRow {
  fixes: string[]; // correzioni fatte in automatico, da mostrare
}

export interface CleanOptions {
  titleCase: boolean; // «ROSSI MARIO» → «Rossi Mario» (nomi, luoghi, indirizzi)
  date1904: boolean;
}

const COMPANY = /\b(s\.?\s?r\.?\s?l|s\.?\s?p\.?\s?a|s\.?\s?n\.?\s?c|s\.?\s?a\.?\s?s|a\.?\s?s\.?\s?d|s\.?\s?s\.?\s?d|soc|societa|cooperativa|coop|associazione|circolo|club|lega navale|onlus|ditta|impresa|fondazione|consorzio)\b/i;

/** «ROSSI MARIO» → «Rossi Mario», «D'ANGELO» → «D'Angelo», «VIA G.B. CRUCIANI 12» → «Via G.B. Cruciani 12». */
export function titleCase(s: string): string {
  if (!s || s !== s.toUpperCase()) return s; // già scritto a mano con maiuscole e minuscole: non si tocca
  return s.toLowerCase().replace(/(^|[\s'’\-./(])([a-zà-ÿ])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function parseNumber(v: CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(v.replace(/\s/g, ""));
  return m ? Number(m[0].replace(",", ".")) : null;
}

function parseDate(v: CellValue, date1904: boolean): string | null {
  if (typeof v === "number") return excelSerialToISO(v, date1904);
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? (Number(m[3]) > 30 ? `19${m[3]}` : `20${m[3]}`) : m[3];
    const iso = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isValidISODate(iso) ? iso : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m && isValidISODate(m[0]) ? m[0] : null;
}

const ENGINE_CODES: Record<string, string> = { F: "fuoribordo", FB: "fuoribordo", EB: "entrobordo", EFB: "entrofuoribordo", EF: "entrofuoribordo", IB: "entrobordo" };

// Misura in centimetri: i valori piccoli sono metri scritti come tali (6,98 → 698 cm).
function measureCm(v: CellValue, metersBelow: number): { cm: number | null; fromMeters: boolean; raw: string } {
  const raw = cellText(v);
  const n = parseNumber(v);
  if (n === null || n <= 0) return { cm: null, fromMeters: false, raw };
  if (n < metersBelow) return { cm: Math.round(n * 100), fromMeters: true, raw };
  return { cm: Math.round(n), fromMeters: false, raw };
}

// Più numeri nella stessa cella: separati da barra, punto e virgola, trattino tra numeri, doppio spazio,
// oppure due cellulari scritti di seguito.
export function splitPhones(value: string): string[] {
  const parts = value
    .split(/\s*[/;,|]\s*|\s+-\s+|(?<=\d{6})-(?=\d{6})|\s{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const digits = p.replace(/[^\d]/g, "");
    if (digits.length >= 18 && digits.startsWith("3") && !p.startsWith("+")) out.push(digits.slice(0, 10), digits.slice(10));
    else out.push(p);
  }
  return out;
}

const intOrNull = (v: CellValue) => {
  const n = parseNumber(v);
  return n === null ? null : Math.round(n);
};

/** Pulisce una riga del foglio e la trasforma nella scheda cliente (e barca), annotando le correzioni fatte. */
export function cleanRow(raw: RawRow, options: CleanOptions, today: string): ReviewedRow {
  const v = raw.values;
  const text = (k: FieldKey) => cellText(v[k] ?? null);
  const fixes: string[] = [];
  const tc = (s: string) => (options.titleCase ? titleCase(s) : s);

  // Identificativi fiscali: una colonna unica o due separate.
  let fiscalCode = "";
  let vatNumber = "";
  for (const k of ["fiscalId", "fiscalCode", "vatNumber"] as const) {
    let id = text(k).replace(/[\s.\-/]/g, "").toUpperCase();
    if (!id) continue;
    if (/^IT\d{11}$/.test(id)) id = id.slice(2);
    if (/^\d{8,10}$/.test(id) && isValidVatNumber(id.padStart(11, "0"))) {
      fixes.push(`Partita IVA senza gli zeri iniziali (li toglie Excel): ${id} → ${id.padStart(11, "0")}`);
      id = id.padStart(11, "0");
    }
    if (/^\d{11}$/.test(id)) vatNumber ||= id;
    else fiscalCode ||= id;
  }

  const fullName = text("fullName");
  const companyColumn = text("companyName");
  const isCompany = Boolean(companyColumn) || COMPANY.test(fullName) || (!fiscalCode && Boolean(vatNumber) && !text("firstName"));
  let firstName = "";
  let lastName = "";
  let companyName = "";
  if (isCompany) {
    companyName = companyColumn || fullName || [text("lastName"), text("firstName")].filter(Boolean).join(" ");
    if (!fiscalCode && vatNumber) fiscalCode = vatNumber; // per le società il codice fiscale è di solito la partita IVA
  } else if (text("lastName") || text("firstName")) {
    lastName = tc(text("lastName"));
    firstName = tc(text("firstName"));
  } else if (fullName) {
    const byCode = splitNameByFiscalCode(fullName, fiscalCode);
    const parts = byCode ?? splitNameGuess(fullName);
    if (!byCode && parts.firstName) fixes.push(`Cognome «${tc(parts.lastName)}» e nome «${tc(parts.firstName)}» divisi a intuito: controlla.`);
    lastName = tc(parts.lastName);
    firstName = tc(parts.firstName);
  }

  let birthDate = "";
  if (v.birthDate !== undefined) {
    const d = parseDate(v.birthDate, options.date1904);
    if (d && d >= "1900-01-01" && d <= today) birthDate = d;
    else fixes.push(`Data di nascita non leggibile, non importata: «${text("birthDate")}»`);
  }

  let zip = text("zip").replace(/\s/g, "");
  if (/^\d{4}$/.test(zip)) {
    fixes.push(`CAP di 4 cifre (Excel aveva tolto lo zero iniziale): ${zip} → 0${zip}`);
    zip = `0${zip}`;
  }

  let province = text("province");
  if (province) {
    const code = provinceCode(province);
    if (code && code !== province) {
      if (code !== province.toUpperCase()) fixes.push(`Provincia «${province}» → ${code}`);
      province = code;
    } else if (!code) province = province.toUpperCase();
  }

  const phones = splitPhones(text("phone"));
  const phone = phones.join(" / ");
  if (phones.length > 1 && !text("phone").includes("/")) fixes.push(`Più numeri nella stessa cella, separati: ${phone}`);

  let email = text("email").toLowerCase().replace(/\s/g, "");
  const emails = email.split(/[;,]/).filter(Boolean);
  if (emails.length > 1) {
    email = emails[0];
    fixes.push(`Più email nella stessa cella: tenuta la prima (${email}), le altre nelle note.`);
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) {
    fixes.push(`Email non valida, non importata: «${text("email")}»`);
    email = "";
  }

  let sdiCode = text("sdiCode").toUpperCase().replace(/\s/g, "");
  if (/^0{6}$/.test(sdiCode)) {
    sdiCode = "0000000";
    fixes.push("Codice SDI di 6 zeri → 0000000");
  }

  const otherEmails = emails.slice(1);
  const notes = [text("ownerNotes"), otherEmails.length ? `Altre email: ${otherEmails.join(", ")}` : ""].filter(Boolean).join(" · ");

  const owner: ImportOwner = {
    type: isCompany ? "azienda" : "persona",
    firstName,
    lastName,
    companyName,
    fiscalCode,
    vatNumber,
    birthDate,
    birthPlace: tc(text("birthPlace")),
    address: tc(text("address")),
    zip,
    city: tc(text("city")),
    province,
    country: text("country") ? tc(text("country")) : "Italia",
    phone,
    email,
    pec: text("pec").toLowerCase(),
    sdiCode,
    notes,
  };

  // Barca: solo se il foglio ne ha qualche dato.
  const hasBoat = BOAT_FIELDS.some((k) => text(k) !== "");
  let boat: ImportBoat | null = null;
  if (hasBoat) {
    const length = measureCm(v.length ?? null, 30);
    const beam = measureCm(v.beam ?? null, 15);
    const draftText = text("draft");
    const draft = measureCm(v.draft ?? null, 10);
    if (length.fromMeters) fixes.push(`Lunghezza scritta in metri: ${length.raw} → ${length.cm} cm`);
    if (beam.fromMeters) fixes.push(`Larghezza scritta in metri: ${beam.raw} → ${beam.cm} cm`);
    if (draft.fromMeters) fixes.push(`Pescaggio scritto in metri: ${draft.raw} → ${draft.cm} cm`);
    if (draftText && /\d\s*[-/]\s*\d/.test(draftText)) fixes.push(`Pescaggio «${draftText}»: usato il primo valore, ${draft.cm} cm`);

    const category = simplify(text("boatCategory"));
    const kind = simplify(text("boatKind"));
    const type: ImportBoat["type"] = /gommon|rib|pneumatic/.test(`${kind} ${category}`)
      ? "gommone"
      : /catamaran/.test(`${kind} ${category}`)
        ? "catamarano"
        : /vela|sail/.test(`${category} ${kind}`)
          ? "vela"
          : "motore";

    const builder = text("builder");
    const model = text("model");
    let name = text("boatName");
    if (!name) {
      // Senza nome si usano cantiere e modello (la pagina lo spiega una volta sola, non riga per riga).
      name = [builder, model].filter(Boolean).join(" ") || `Barca di ${isCompany ? companyName : [lastName, firstName].filter(Boolean).join(" ")}`;
    }
    const year = intOrNull(v.year ?? null);
    const engineCode = (k: FieldKey) => {
      const t = text(k);
      return ENGINE_CODES[t.toUpperCase()] ?? t.toLowerCase();
    };
    const declared = parseNumber(v.declaredValue ?? null);
    let expiry = "";
    if (v.insuranceExpiry !== undefined) {
      expiry = parseDate(v.insuranceExpiry, options.date1904) ?? "";
      if (!expiry) fixes.push(`Scadenza della polizza non leggibile, non importata: «${text("insuranceExpiry")}»`);
    }
    boat = {
      name,
      registration: text("registration").toUpperCase(),
      type,
      builder,
      model,
      year: year && year >= 1900 && year <= Number(today.slice(0, 4)) + 1 ? year : null,
      lengthCm: length.cm,
      beamCm: beam.cm,
      draftCm: draft.cm,
      flag: text("flag").toUpperCase(),
      engineType: engineCode("engineType"),
      engineBrand: text("engineBrand"),
      engineCount: intOrNull(v.engineCount ?? null),
      enginePowerHp: intOrNull(v.enginePower ?? null),
      auxEngineType: engineCode("auxEngineType"),
      auxEngineBrand: text("auxEngineBrand"),
      auxEngineCount: intOrNull(v.auxEngineCount ?? null),
      auxEnginePowerHp: intOrNull(v.auxEnginePower ?? null),
      declaredValueCents: declared !== null && declared > 0 ? Math.round(declared * 100) : null,
      insuranceCompany: text("insuranceCompany"),
      insurancePolicy: text("insurancePolicy"),
      insuranceExpiry: expiry,
    };
  }

  return { row: raw.row, owner, boat, excluded: false, fixes };
}

/** Nome mostrato del cliente, come lo salva l'app («Cognome Nome» o ragione sociale). */
export function displayNameOf(o: Pick<ImportOwner, "type" | "firstName" | "lastName" | "companyName">): string {
  return o.type === "azienda" ? o.companyName.trim() : [o.lastName.trim(), o.firstName.trim()].filter(Boolean).join(" ");
}

/** Controlli sulla riga così com'è (anche dopo le modifiche fatte a mano nell'anteprima). */
export function checkRow(r: ImportRow): Issue[] {
  const issues: Issue[] = [];
  const o = r.owner;
  if (!displayNameOf(o)) issues.push({ level: "blocca", message: o.type === "azienda" ? "Manca la ragione sociale." : "Manca il cognome." });
  if (o.type === "persona" && o.lastName && !o.firstName) issues.push({ level: "avviso", message: "Manca il nome." });
  if (o.fiscalCode) {
    if (o.fiscalCode.length === 16 && !isValidFiscalCode(o.fiscalCode)) issues.push({ level: "avviso", message: `Codice fiscale ${o.fiscalCode} non valido (carattere di controllo).` });
    else if (o.fiscalCode.length !== 16 && !(o.type === "azienda" && /^\d{11}$/.test(o.fiscalCode))) {
      issues.push({ level: "avviso", message: `Codice fiscale «${o.fiscalCode}» in un formato non riconosciuto.` });
    }
  } else if (!o.vatNumber) issues.push({ level: "avviso", message: "Mancano codice fiscale e partita IVA." });
  if (o.vatNumber && !isValidVatNumber(o.vatNumber)) issues.push({ level: "avviso", message: `Partita IVA ${o.vatNumber} non valida.` });
  if (o.zip && !/^\d{5}$/.test(o.zip) && o.country.toLowerCase() === "italia") issues.push({ level: "avviso", message: `CAP «${o.zip}» non valido.` });
  if (o.province && !/^[A-Z]{2}$/.test(o.province)) issues.push({ level: "avviso", message: `Provincia «${o.province}» non riconosciuta.` });
  if (o.phone) {
    const numbers = o.phone.split("/").map((p) => p.replace(/[^\d]/g, ""));
    if (numbers.some((n) => n.length < 6 || n.length > 13)) issues.push({ level: "avviso", message: `Telefono «${o.phone}» da controllare.` });
  } else if (!o.email) issues.push({ level: "avviso", message: "Nessun recapito: mancano telefono ed email." });
  if (o.sdiCode && !/^[A-Z0-9]{7}$/.test(o.sdiCode)) issues.push({ level: "avviso", message: `Codice SDI «${o.sdiCode}» non valido (servono 7 caratteri).` });
  if (r.boat) {
    const b = r.boat;
    if (!b.lengthCm || !b.beamCm) issues.push({ level: "avviso", message: "La barca non ha lunghezza e larghezza: senza le misure non viene creata." });
    else {
      if (b.lengthCm < 150 || b.lengthCm > 8000) issues.push({ level: "avviso", message: `Lunghezza ${b.lengthCm} cm da controllare.` });
      if (b.beamCm < 80 || b.beamCm > 2000) issues.push({ level: "avviso", message: `Larghezza ${b.beamCm} cm da controllare.` });
    }
  }
  return issues;
}

export function boatIsComplete(b: ImportBoat | null): b is ImportBoat & { lengthCm: number; beamCm: number } {
  return Boolean(b && b.name.trim() && b.lengthCm && b.beamCm);
}

// ───────────────────────── Doppioni ─────────────────────────

const nameKey = (s: string) => simplify(s).replace(/\s/g, "");

/** Chiave che identifica un cliente: codice fiscale, poi partita IVA, poi nome (con la data di nascita se c'è). */
export function ownerKey(o: ImportOwner): string {
  if (o.fiscalCode && o.fiscalCode.length === 16) return `CF:${o.fiscalCode}`;
  if (o.vatNumber) return `IVA:${o.vatNumber}`;
  if (o.fiscalCode) return `CF:${o.fiscalCode}`;
  return `NOME:${nameKey(displayNameOf(o))}${o.birthDate ? `:${o.birthDate}` : ""}`;
}

export interface OwnerGroup {
  key: string;
  owner: ImportOwner; // unione delle righe: per ogni campo il primo valore non vuoto
  rows: number[]; // righe di Excel, nell'ordine
  boats: { row: number; boat: ImportBoat }[];
  conflicts: string[]; // valori diversi tra le righe dello stesso cliente
}

const CONFLICT_FIELDS: [keyof ImportOwner, string][] = [
  ["email", "email"],
  ["address", "indirizzo"],
  ["city", "comune"],
  ["birthDate", "data di nascita"],
];

/** Raggruppa le righe dello stesso cliente (un cliente con più barche, o righe ripetute). Le righe escluse non contano. */
export function groupRows(rows: ImportRow[]): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>();
  for (const r of rows) {
    if (r.excluded || !displayNameOf(r.owner)) continue;
    const key = ownerKey(r.owner);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, owner: { ...r.owner }, rows: [r.row], boats: r.boat ? [{ row: r.row, boat: r.boat }] : [], conflicts: [] });
      continue;
    }
    g.rows.push(r.row);
    if (r.boat) g.boats.push({ row: r.row, boat: r.boat });
    for (const k of Object.keys(g.owner) as (keyof ImportOwner)[]) {
      const mine = g.owner[k];
      const theirs = r.owner[k];
      if (!mine && theirs) (g.owner as unknown as Record<string, string>)[k] = theirs;
    }
    // Telefoni diversi non sono un problema: si tengono tutti.
    if (g.owner.phone && r.owner.phone) {
      const known = g.owner.phone.split(" / ");
      const digits = (p: string) => p.replace(/\D/g, "");
      for (const p of r.owner.phone.split(" / ")) {
        const merged = [...known, p].join(" / ");
        if (!known.some((k) => digits(k) === digits(p)) && merged.length <= 120) known.push(p);
      }
      g.owner.phone = known.join(" / ");
    }
    for (const [k, label] of CONFLICT_FIELDS) {
      if (g.owner[k] && r.owner[k] && simplify(g.owner[k]) !== simplify(r.owner[k])) {
        g.conflicts.push(`Riga ${r.row}: ${label} «${r.owner[k]}» diverso da «${g.owner[k]}» (riga ${g.rows[0]}), tenuto il primo.`);
      }
    }
  }
  return [...groups.values()];
}

/** Barche uguali dello stesso cliente (stessa iscrizione, o stesso nome e lunghezza): se ne crea una sola. */
export function sameBoat(a: Pick<ImportBoat, "name" | "registration" | "lengthCm">, b: Pick<ImportBoat, "name" | "registration" | "lengthCm">): boolean {
  if (a.registration && b.registration) return simplify(a.registration) === simplify(b.registration);
  return nameKey(a.name) === nameKey(b.name) && (a.lengthCm === b.lengthCm || !a.lengthCm || !b.lengthCm);
}
