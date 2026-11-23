// «Allinea in fila» nell'editor della Mappa del porto: rimette dritti i posti scelti, dove sono.
import { compareCodes } from "./berth-codes";
import type { Placement } from "./plan";

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
 * Posti scelti rimessi in fila: direzione dall'orientamento medio dei posti, verso dal primo all'ultimo codice; le file (una, o
 * due una di fronte all'altra) si riconoscono dalla distanza di traverso. Ogni fila diventa dritta, in ordine di codice, a passo
 * uguale (quello medio di prima, ma mai sovrapposti), tutte dalla stessa radice e con i posti allo stesso angolo.
 */
export function alignRows(berths: AlignBerth[], pxPerMeter: number): Placement[] {
  if (berths.length < 2 || pxPerMeter <= 0) return [];
  let cx = 0;
  let cy = 0;
  for (const b of berths) {
    cx += Math.cos((2 * b.angle * Math.PI) / 180);
    cy += Math.sin((2 * b.angle * Math.PI) / 180);
  }
  const a = Math.atan2(cy, cx) / 2;
  let d = { x: Math.cos(a), y: Math.sin(a) };
  const byCode = [...berths].sort((p, q) => compareCodes(p.code, q.code));
  const first = byCode[0];
  const last = byCode[byCode.length - 1];
  if ((last.x - first.x) * d.x + (last.y - first.y) * d.y < 0) d = { x: -d.x, y: -d.y };
  const left = { x: d.y, y: -d.x };
  const origin = { x: first.x, y: first.y };
  const along = (b: AlignBerth) => (b.x - origin.x) * d.x + (b.y - origin.y) * d.y;
  const across = (b: AlignBerth) => (b.x - origin.x) * left.x + (b.y - origin.y) * left.y;

  // File: si separano dove, di traverso, c'è uno stacco di più di mezzo posto.
  const lengthPx = (median(berths.map((b) => b.lengthCm)) / 100) * pxPerMeter;
  const sorted = [...berths].sort((p, q) => across(p) - across(q));
  const rows: AlignBerth[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (across(sorted[i]) - across(sorted[i - 1]) > 0.5 * lengthPx) rows.push([]);
    rows[rows.length - 1].push(sorted[i]);
  }

  // Passo comune: quello medio di prima nella fila più lunga, ma almeno la larghezza del posto più un margine.
  const beamPx = (Math.max(...berths.map((b) => b.beamCm)) / 100) * pxPerMeter;
  const pitches = rows.filter((r) => r.length > 1).map((r) => (Math.max(...r.map(along)) - Math.min(...r.map(along))) / (r.length - 1));
  const pitch = Math.max(pitches.length ? Math.max(...pitches) : 0, beamPx * 1.05);
  const start = Math.min(...berths.map(along));
  const angle = Math.round(((Math.atan2(d.y, d.x) * 180) / Math.PI) * 100) / 100;

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
