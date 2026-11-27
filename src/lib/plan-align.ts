// «Allinea in fila» nell'editor della Mappa del porto: rimette dritti i posti scelti, dove sono.
import { compareCodes } from "./berth-codes";
import { normalizeAngle, rowAxis, type Placement } from "./plan";

export interface AlignBerth {
  id: string;
  code: string;
  x: number;
  y: number;
  /** Gradi; a 0° il lato lungo è verticale. */
  angle: number;
  lengthCm: number;
  beamCm: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Posti scelti rimessi in fila: direzione dall'orientamento medio dei posti (all'inglese, se stanno uno dietro l'altro, lungo il
 * loro lato lungo), verso dal primo all'ultimo codice; le file (una, o
 * due una di fronte all'altra) si riconoscono dalla distanza di traverso. Ogni fila diventa dritta, in ordine di codice, a passo
 * uguale (quello medio di prima, ma mai sovrapposti), tutte dalla stessa radice e con i posti allo stesso angolo.
 */
export function alignRows(berths: AlignBerth[], pxPerMeter: number): Placement[] {
  if (berths.length < 2 || pxPerMeter <= 0) return [];
  const axis = rowAxis(berths, pxPerMeter);
  const alongside = axis.mooring === "inglese";
  let d = axis.d;
  const byCode = [...berths].sort((p, q) => compareCodes(p.code, q.code));
  const first = byCode[0];
  const last = byCode[byCode.length - 1];
  if ((last.x - first.x) * d.x + (last.y - first.y) * d.y < 0) d = { x: -d.x, y: -d.y };
  const left = { x: d.y, y: -d.x };
  const origin = { x: first.x, y: first.y };
  const along = (b: AlignBerth) => (b.x - origin.x) * d.x + (b.y - origin.y) * d.y;
  const across = (b: AlignBerth) => (b.x - origin.x) * left.x + (b.y - origin.y) * left.y;

  // File: si separano dove, di traverso, c'è uno stacco di più di mezzo posto (all'inglese, di mezza larghezza).
  const lengthPx = (median(berths.map((b) => (alongside ? b.beamCm : b.lengthCm))) / 100) * pxPerMeter;
  const sorted = [...berths].sort((p, q) => across(p) - across(q));
  const rows: AlignBerth[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (across(sorted[i]) - across(sorted[i - 1]) > 0.5 * lengthPx) rows.push([]);
    rows[rows.length - 1].push(sorted[i]);
  }

  // Passo comune: quello medio di prima nella fila più lunga, ma almeno la larghezza del posto (all'inglese la lunghezza) più un margine.
  const beamPx = (Math.max(...berths.map((b) => (alongside ? b.lengthCm : b.beamCm))) / 100) * pxPerMeter;
  const pitches = rows.filter((r) => r.length > 1).map((r) => (Math.max(...r.map(along)) - Math.min(...r.map(along))) / (r.length - 1));
  const pitch = Math.max(pitches.length ? Math.max(...pitches) : 0, beamPx * 1.05);
  const start = Math.min(...berths.map(along));
  const lineAngle = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  const angle = normalizeAngle(alongside ? lineAngle + 90 : lineAngle);

  return rows.flatMap((row) => {
    const offset = median(row.map(across));
    return [...row]
      .sort((p, q) => compareCodes(p.code, q.code))
      .map((b, i) => {
        const t = start + pitch * i;
        return { id: b.id, x: round1(origin.x + d.x * t + left.x * offset), y: round1(origin.y + d.y * t + left.y * offset), angle };
      });
  });
}

/**
 * «Lunghezza ±»: allunga o accorcia di `meters` i posti scelti lungo la loro fila, dal centro, lasciandoli in fila. Le file (una, o due
 * una di fronte all'altra) si riconoscono come in `alignRows`; ogni posto resta nella sua fila (rimessa dritta, alla distanza di
 * traverso tipica della fila) e nel suo ordine, con il suo angolo. Due posti vicini della stessa fila non si sovrappongono mai: accorciando
 * ci si ferma quando si toccano (all'inglese conta la lunghezza, di prua la larghezza). `scale` è il fattore applicato lungo la fila.
 */
export function stretchRows(berths: AlignBerth[], pxPerMeter: number, meters: number): { placements: Placement[]; scale: number; mid: number; d: { x: number; y: number } } | null {
  if (berths.length < 2 || pxPerMeter <= 0) return null;
  const axis = rowAxis(berths, pxPerMeter);
  const alongside = axis.mooring === "inglese";
  const d = axis.d;
  const n = { x: -d.y, y: d.x };
  const along = (b: AlignBerth) => b.x * d.x + b.y * d.y;
  const across = (b: AlignBerth) => b.x * n.x + b.y * n.y;
  const ts = berths.map(along);
  const lo = Math.min(...ts);
  const hi = Math.max(...ts);
  const len = hi - lo;
  if (len < 1) return null;
  const scale = Math.max(0.05, (len + meters * pxPerMeter) / len);
  const mid = (lo + hi) / 2;

  // File: si separano dove, di traverso, c'è uno stacco di più di mezzo posto (all'inglese, di mezza larghezza).
  const depth = (median(berths.map((b) => (alongside ? b.beamCm : b.lengthCm))) / 100) * pxPerMeter;
  const sorted = [...berths].sort((p, q) => across(p) - across(q));
  const rows: AlignBerth[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (across(sorted[i]) - across(sorted[i - 1]) > 0.5 * depth) rows.push([]);
    rows[rows.length - 1].push(sorted[i]);
  }

  const placements: Placement[] = [];
  for (const row of rows) {
    const offset = median(row.map(across));
    const items = [...row].sort((p, q) => along(p) - along(q) || compareCodes(p.code, q.code));
    const t = items.map((b) => mid + (along(b) - mid) * scale);
    // Spazio minimo tra due posti vicini: mezzo posto ciascuno, più un filo.
    const span = (b: AlignBerth) => ((alongside ? b.lengthCm : b.beamCm) / 200) * pxPerMeter;
    const gap = (i: number) => (span(items[i]) + span(items[i + 1])) * 1.02;
    // Dal posto più vicino al centro verso le due estremità.
    let c = 0;
    for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - mid) < Math.abs(t[c] - mid)) c = i;
    for (let i = c + 1; i < t.length; i++) t[i] = Math.max(t[i], t[i - 1] + gap(i - 1));
    for (let i = c - 1; i >= 0; i--) t[i] = Math.min(t[i], t[i + 1] - gap(i));
    items.forEach((b, i) => {
      placements.push({ id: b.id, x: round1(d.x * t[i] + n.x * offset), y: round1(d.y * t[i] + n.y * offset), angle: normalizeAngle(b.angle) });
    });
  }
  return { placements, scale, mid, d };
}
