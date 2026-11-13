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

/**
 * Dispone i posti di un pontile lungo la linea tracciata sulla foto, dalla radice (a) alla testata (b).
 * I posti si distribuiscono a intervalli regolari secondo la loro posizione, perpendicolari al pontile:
 * il lato "sx" a sinistra di chi cammina da a verso b, il lato "dx" a destra.
 */
export function layoutPier(berths: PlanBerth[], a: Point, b: Point, pxPerMeter: number, pierWidthM = 2): Placement[] {
  const length = distance(a, b);
  if (length < 1 || berths.length === 0 || pxPerMeter <= 0) return [];
  const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  // Con l'asse y rivolto in basso (come sullo schermo) la sinistra di chi avanza è (d.y, -d.x).
  const left = { x: d.y, y: -d.x };
  const slots = Math.max(...berths.map((berth) => berth.position)) + 1;
  const angle = round((Math.atan2(d.y, d.x) * 180) / Math.PI, 2);

  return berths.map((berth) => {
    const along = ((berth.position + 0.5) / slots) * length;
    const offset = (pierWidthM / 2 + berth.lengthCm / 200) * pxPerMeter;
    const sign = berth.side === "sx" ? 1 : -1;
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
