// Geometria della "pianta dal vero": i posti barca disegnati sopra la foto aerea del porto.
// Tutte le coordinate sono in pixel dell'immagine caricata.

export interface Point {
  x: number;
  y: number;
}

export interface PlanBerth {
  id: string;
  side: "sx" | "dx";
  position: number;
  lengthCm: number;
  beamCm: number;
}

export interface Placement {
  id: string;
  x: number;
  y: number;
  // Gradi in senso orario; a 0° il lato lungo del posto è verticale.
  angle: number;
}

// Larghezza e lunghezza di un posto in pixel, data la scala della foto.
export function berthSizePx(berth: { lengthCm: number; beamCm: number }, pxPerMeter: number): { w: number; l: number } {
  return { w: (berth.beamCm / 100) * pxPerMeter, l: (berth.lengthCm / 100) * pxPerMeter };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Come stanno le barche rispetto al pontile: «punta» = perpendicolari, con la poppa verso il pontile; «inglese» = di fianco, una dietro l'altra. */
export type Mooring = "punta" | "inglese";

export const MOORING_LABEL: Record<Mooring, string> = { punta: "di punta", inglese: "all'inglese" };

/** Direzione del lato lungo di un posto (a 0° è verticale). */
export function longAxis(angle: number): Point {
  const a = (angle * Math.PI) / 180;
  return { x: -Math.sin(a), y: Math.cos(a) };
}

/** Vero se il posto ha il lato lungo parallelo (più che di traverso) alla direzione d: è ormeggiato all'inglese. */
export function isAlongside(angle: number, d: Point): boolean {
  const v = longAxis(angle);
  const len = Math.hypot(d.x, d.y) || 1;
  return Math.abs(v.x * d.x + v.y * d.y) / len > Math.SQRT1_2;
}

/** Ormeggio prevalente dei posti rispetto alla linea di direzione d. */
export function mooringAlong(berths: { angle: number }[], d: Point): Mooring {
  const alongside = berths.filter((b) => isAlongside(b.angle, d)).length;
  return berths.length > 0 && alongside * 2 > berths.length ? "inglese" : "punta";
}

/** Quanti gruppi formano i valori, separando dove tra uno e il successivo c'è più di `gap`. */
function clusters(values: number[], gap: number): number {
  const sorted = [...values].sort((p, q) => p - q);
  let count = sorted.length > 0 ? 1 : 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > gap) count++;
  return count;
}

const median = (values: number[]) => {
  const s = [...values].sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Direzione di una fila di posti dove sono. Dall'orientamento medio (sugli angoli doppi: 10° e 190° valgono uguale) i posti di punta
 * stanno in una o due file di traverso al loro lato lungo; all'inglese stanno uno dietro l'altro, lungo il lato lungo. Si contano i
 * gruppi di centri nelle due direzioni (separati da più di mezza larghezza di traverso, da più di mezza lunghezza per il lungo): la
 * fila va dove i posti si susseguono, cioè dove i gruppi sono di più; a pari merito, di punta.
 */
export function rowAxis(
  berths: { x: number; y: number; angle: number; lengthCm: number; beamCm: number }[],
  pxPerMeter: number,
): { d: Point; mooring: Mooring } {
  let cx = 0;
  let cy = 0;
  for (const b of berths) {
    cx += Math.cos((2 * b.angle * Math.PI) / 180);
    cy += Math.sin((2 * b.angle * Math.PI) / 180);
  }
  const a = Math.atan2(cy, cx) / 2;
  const across = { x: Math.cos(a), y: Math.sin(a) };
  const lengthwise = { x: -Math.sin(a), y: Math.cos(a) };
  if (berths.length < 2 || pxPerMeter <= 0) return { d: across, mooring: "punta" };
  const onAcross = berths.map((b) => b.x * across.x + b.y * across.y);
  const onLength = berths.map((b) => b.x * lengthwise.x + b.y * lengthwise.y);
  const beam = (median(berths.map((b) => b.beamCm)) / 100) * pxPerMeter;
  const length = (median(berths.map((b) => b.lengthCm)) / 100) * pxPerMeter;
  const rowsAcross = clusters(onAcross, beam / 2);
  const rowsLength = clusters(onLength, length / 2);
  return rowsLength > rowsAcross ? { d: lengthwise, mooring: "inglese" } : { d: across, mooring: "punta" };
}

/**
 * Dispone i posti di un pontile lungo la linea tracciata sulla foto, dalla radice (a) alla testata (b).
 * I posti si distribuiscono a intervalli regolari secondo la loro posizione: perpendicolari al pontile (di punta) o, all'inglese,
 * di fianco al pontile, una barca dietro l'altra. Il lato "sx" a sinistra di chi cammina da a verso b, il lato "dx" a destra
 * (al contrario con `flip`).
 */
export function layoutPier(
  berths: PlanBerth[],
  a: Point,
  b: Point,
  pxPerMeter: number,
  pierWidthM = 2,
  flip = false,
  mooring: Mooring = "punta",
): Placement[] {
  const length = distance(a, b);
  if (length < 1 || berths.length === 0 || pxPerMeter <= 0) return [];
  const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  // Con l'asse y rivolto in basso (come sullo schermo) la sinistra di chi avanza è (d.y, -d.x).
  const left = { x: d.y, y: -d.x };
  const slots = Math.max(...berths.map((berth) => berth.position)) + 1;
  const lineAngle = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  const alongside = mooring === "inglese";
  const angle = alongside ? normalizeAngle(lineAngle + 90) : round(lineAngle, 2);

  return berths.map((berth) => {
    const along = ((berth.position + 0.5) / slots) * length;
    // Di punta il posto sporge di metà lunghezza, all'inglese di metà larghezza.
    const offset = (pierWidthM / 2 + (alongside ? berth.beamCm : berth.lengthCm) / 200) * pxPerMeter;
    // flip: i posti finiscono dall'altro lato della linea (es. banchina tracciata dalla parte "sbagliata").
    const sign = (berth.side === "sx" ? 1 : -1) * (flip ? -1 : 1);
    return {
      id: berth.id,
      x: round(a.x + d.x * along + left.x * offset * sign, 1),
      y: round(a.y + d.y * along + left.y * offset * sign, 1),
      angle,
    };
  });
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// Riporta un angolo nell'intervallo (-180, 180].
export function normalizeAngle(angle: number): number {
  const a = ((((angle + 180) % 360) + 360) % 360) - 180;
  return a === -180 ? 180 : round(a, 2);
}

export interface ImageInfo {
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

/**
 * Riconosce JPEG e PNG dai primi byte e ne legge le dimensioni, senza librerie esterne.
 * Restituisce null se il contenuto non è un'immagine di questi formati: serve a non fidarsi
 * del tipo dichiarato dal browser quando si carica la foto.
 */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const u32 = (i: number) => bytes[i] * 2 ** 24 + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];

  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 24 && png.every((v, i) => bytes[i] === v)) {
    const width = u32(16);
    const height = u32(20);
    return width > 0 && height > 0 ? { mime: "image/png", width, height } : null;
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++; // byte di riempimento
        continue;
      }
      // Marcatori senza contenuto.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2;
        continue;
      }
      // SOF0…SOF15 (esclusi DHT, JPG e DAC) contengono altezza e larghezza.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = u16(i + 5);
        const width = u16(i + 7);
        return width > 0 && height > 0 ? { mime: "image/jpeg", width, height } : null;
      }
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

export type BerthLayout = "alternati" | "sx" | "dx";

/**
 * Lato e posizione lungo il pontile dei posti creati in blocco.
 * Ogni lato ha la sua numerazione delle posizioni: così un pontile può avere 25 posti a sinistra e 22 a destra,
 * uno di fronte all'altro a partire dalla radice. I nuovi posti proseguono dopo quelli già presenti su quel lato.
 * nextSx / nextDx: prima posizione libera su ciascun lato.
 */
export function berthSlots(layout: BerthLayout, count: number, nextSx: number, nextDx: number): { side: "sx" | "dx"; position: number }[] {
  if (layout === "sx") return Array.from({ length: count }, (_, i) => ({ side: "sx", position: nextSx + i }));
  if (layout === "dx") return Array.from({ length: count }, (_, i) => ({ side: "dx", position: nextDx + i }));
  // Alternati: si riparte dalla stessa posizione sui due lati, così i posti restano uno di fronte all'altro.
  const start = Math.max(nextSx, nextDx);
  return Array.from({ length: count }, (_, i) => ({ side: i % 2 === 0 ? "sx" : "dx", position: start + Math.floor(i / 2) }));
}
