// Lettore minimo di file Excel (.xlsx) che funziona sia nel browser sia sul server, senza dipendenze.
// Un .xlsx è un archivio ZIP di file XML: qui si leggono solo i fogli, i testi condivisi e i valori
// delle celle (per le formule, l'ultimo risultato salvato da Excel).

export type CellValue = string | number | boolean | null;

export interface Sheet {
  name: string;
  // Righe in ordine, con il numero di riga di Excel e le celle per colonna (0 = A).
  rows: { row: number; cells: CellValue[] }[];
}

export interface Workbook {
  sheets: Sheet[];
  // true se il file usa il calendario 1904 (vecchi Excel per Mac): cambia l'origine delle date.
  date1904: boolean;
}

export class XlsxError extends Error {}

// ───────────────────────── ZIP ─────────────────────────

interface ZipEntry {
  method: number;
  compressedSize: number;
  localOffset: number;
}

function zipEntries(data: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Il record di fine archivio sta negli ultimi 22 byte più l'eventuale commento (max 64 KB).
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("Il file non è un documento Excel (.xlsx).");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > data.length || view.getUint32(p, true) !== 0x02014b50) throw new XlsxError("Il file Excel è danneggiato.");
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = decoder.decode(data.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, {
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      localOffset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(data: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const p = entry.localOffset;
  if (view.getUint32(p, true) !== 0x04034b50) throw new XlsxError("Il file Excel è danneggiato.");
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  const raw = data.subarray(start, start + entry.compressedSize);
  let bytes: Uint8Array;
  if (entry.method === 0) bytes = raw;
  else if (entry.method === 8) bytes = await inflateRaw(raw);
  else throw new XlsxError("Il file Excel usa una compressione non supportata.");
  return new TextDecoder().decode(bytes);
}

// ───────────────────────── XML ─────────────────────────

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, code: string) => {
    if (code === "amp") return "&";
    if (code === "lt") return "<";
    if (code === "gt") return ">";
    if (code === "quot") return '"';
    if (code === "apos") return "'";
    const n = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return String.fromCodePoint(n);
  });
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]) : null;
}

// Testo di un elemento con "pezzi" <t> (testi condivisi, testi in linea), escluse le letture fonetiche.
function runText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += m[1] ? decodeXml(m[1]) : "";
  return out;
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => (m[1] ? runText(m[1]) : ""));
}

export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): Sheet["rows"] {
  const data = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? "";
  const rows: Sheet["rows"] = [];
  let lastRow = 0;
  for (const rm of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(attr(rm[1], "r")) || lastRow + 1;
    lastRow = rowNumber;
    const cells: CellValue[] = [];
    let lastCol = -1;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], "r");
      const col = ref ? columnIndex(ref) : lastCol + 1;
      lastCol = col;
      const type = attr(cm[1], "t");
      const body = cm[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: CellValue = null;
      if (type === "inlineStr") value = runText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (v === undefined) value = null;
      else if (type === "s") value = shared[Number(v)] ?? null;
      else if (type === "str") value = decodeXml(v);
      else if (type === "b") value = v === "1";
      else if (type === "e") value = null;
      else {
        const n = Number(v);
        value = Number.isFinite(n) ? n : decodeXml(v);
      }
      if (value !== null) {
        while (cells.length < col) cells.push(null);
        cells[col] = value;
      }
    }
    rows.push({ row: rowNumber, cells });
  }
  return rows;
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return `xl/${target}`.replace(/\/\.\//g, "/");
}

export async function readXlsx(input: ArrayBuffer | Uint8Array): Promise<Workbook> {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = zipEntries(data);
  const read = async (name: string) => {
    const e = entries.get(name);
    return e ? readEntry(data, e) : null;
  };
  const workbookXml = await read("xl/workbook.xml");
  if (!workbookXml) throw new XlsxError("Il file non è un documento Excel (.xlsx).");
  const relsXml = (await read("xl/_rels/workbook.xml.rels")) ?? "";
  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], "Id");
    const target = attr(m[1], "Target");
    if (id && target) rels.set(id, resolveTarget(target));
  }
  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbookXml);

  const sheets: Sheet[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = attr(m[1], "name") ?? `Foglio ${sheets.length + 1}`;
    const rid = attr(m[1], "r:id");
    const path = rid ? rels.get(rid) : undefined;
    const xml = path ? await read(path) : null;
    if (xml) sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  return { sheets, date1904 };
}

// Numero di serie di Excel → data AAAA-MM-GG (si ignora l'ora).
export function excelSerialToISO(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  const days = Math.floor(serial) + (date1904 ? 1462 : 0);
  const d = new Date(Date.UTC(1899, 11, 30) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
