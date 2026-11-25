// Disegno pulito del porto ricavato dalla pianta dal vero: pontili come strisce grigie e, su ogni posto,
// la barca orientata con la poppa verso il pontile. Tutte le coordinate sono in pixel della foto.

import { isAlongside, longAxis, rowAxis, type Point } from "./plan";

export interface DrawingBerth {
  id: string;
  side: "sx" | "dx";
  x: number;
  y: number;
  // Gradi in senso orario; a 0° il lato lungo del posto è verticale.
  angle: number;
  lengthCm: number;
  beamCm: number;
}

export interface DrawingPier {
  id: string;
  name: string;
  // Linea tracciata dalla radice alla testata, con la larghezza in metri (0 = banchina); null se mai tracciata.
  trace: { a: Point; b: Point; widthM: number } | null;
  berths: DrawingBerth[];
}

export interface PierShape {
  id: string;
  name: string;
  // Quattro vertici della striscia del pontile.
  outline: Point[];
  label: { x: number; y: number; anchor: "start" | "middle" | "end" };
}

export interface Drawing {
  piers: PierShape[];
  // Per ogni posto: +1 se la poppa sta verso la y positiva del posto (prima della rotazione), -1 se verso la negativa.
  stern: Map<string, 1 | -1>;
  bounds: { x: number; y: number; width: number; height: number };
}

const dot = (p: Point, q: Point) => p.x * q.x + p.y * q.y;

const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

export function buildDrawing(piers: DrawingPier[], pxPerMeter: number): Drawing | null {
  const m = pxPerMeter;
  const stern = new Map<string, 1 | -1>();
  const shapes: PierShape[] = [];
  const all = piers.flatMap((p) => p.berths);
  if (all.length === 0 || m <= 0) return null;
  const center = { x: mean(all.map((b) => b.x)), y: mean(all.map((b) => b.y)) };

  for (const pier of piers) {
    const list = pier.berths;
    const trace = pier.trace && Math.hypot(pier.trace.b.x - pier.trace.a.x, pier.trace.b.y - pier.trace.a.y) > 1 ? pier.trace : null;
    if (list.length === 0 && !trace) continue;

    // d: lungo il pontile (dalla radice alla testata quando è tracciato); n: di traverso.
    let d: Point;
    if (trace) {
      const len = Math.hypot(trace.b.x - trace.a.x, trace.b.y - trace.a.y);
      d = { x: (trace.b.x - trace.a.x) / len, y: (trace.b.y - trace.a.y) / len };
    } else {
      // Senza linea la direzione viene dai posti: di traverso al lato lungo, o lungo il lato lungo se sono all'inglese.
      d = rowAxis(list, m).d;
    }
    const n = { x: -d.y, y: d.x };
    // Posti all'inglese: di fianco al pontile, la poppa non è verso il pontile e sporgono di metà larghezza.
    const alongside = new Set(list.filter((b) => isAlongside(b.angle, d)).map((b) => b.id));

    // Da che parte del pontile sta ogni posto e dove ha la poppa.
    const across = (p: Point) => dot(p, n);
    let lineAt: number; // posizione della linea del pontile di traverso
    let half: number; // mezza larghezza della striscia
    let quaySide = 0; // per le banchine: da che parte (±1) si allarga la terra

    if (trace) {
      lineAt = across(trace.a);
      for (const b of list) {
        const v = longAxis(b.angle);
        const toLine = lineAt - across(b);
        stern.set(b.id, alongside.has(b.id) || dot(v, n) * toLine >= 0 ? 1 : -1);
      }
      const sides = new Set(list.map((b) => Math.sign(across(b) - lineAt)));
      if (trace.widthM >= 0.5) {
        half = (trace.widthM / 2) * m;
      } else if (sides.size === 1) {
        // Banchina: le poppe toccano la linea, la terra sta dall'altra parte.
        half = 0;
        quaySide = -[...sides][0] || -1;
      } else {
        half = 0.75 * m;
      }
    } else {
      // Senza linea tracciata: i due lati si guardano; con un lato solo vale la regola del tracciamento (sx a sinistra).
      const bySide = { sx: list.filter((b) => b.side === "sx"), dx: list.filter((b) => b.side === "dx") };
      const both = bySide.sx.length > 0 && bySide.dx.length > 0;
      const meanOf = (side: "sx" | "dx") => mean(bySide[side].map(across));
      // dir: segno, lungo n, della direzione verso il pontile.
      const dirOf = new Map<string, number>();
      for (const b of list) {
        const v = longAxis(b.angle);
        let dir: number;
        if (both) dir = Math.sign(meanOf(b.side === "sx" ? "dx" : "sx") - across(b)) || 1;
        // All'inglese il lato lungo non dice dove sta il pontile: vale la regola del tracciamento (sx a sinistra, cioè verso -n).
        else if (alongside.has(b.id)) dir = b.side === "sx" ? 1 : -1;
        else dir = Math.sign(dot(b.side === "sx" ? v : { x: -v.x, y: -v.y }, n)) || 1;
        dirOf.set(b.id, dir);
        stern.set(b.id, alongside.has(b.id) || Math.sign(dot(v, n)) * dir >= 0 ? 1 : -1);
      }
      // Bordo del posto verso il pontile: la poppa (di prua) o il fianco (all'inglese).
      const sternAt = (b: DrawingBerth) => {
        const reach = alongside.has(b.id) ? b.beamCm / 200 : (Math.abs(dot(longAxis(b.angle), n)) * b.lengthCm) / 200;
        return across(b) + dirOf.get(b.id)! * reach * m;
      };
      if (both) {
        const a = mean(bySide.sx.map(sternAt));
        const c = mean(bySide.dx.map(sternAt));
        lineAt = (a + c) / 2;
        half = Math.max(Math.abs(a - c) / 2, 0.75 * m);
      } else {
        // Un lato solo: la striscia sta dietro le poppe.
        const sternLine = mean(list.map(sternAt));
        const out = Math.sign(sternLine - mean(list.map(across))) || 1;
        lineAt = sternLine;
        half = 0;
        quaySide = out;
      }
    }

    // Estensione lungo il pontile: tutti i posti (con la loro larghezza) più la linea tracciata.
    const along = list.flatMap((b) => {
      const t = dot(b, d);
      const r = ((alongside.has(b.id) ? b.lengthCm : b.beamCm) / 200) * m;
      return [t - r, t + r];
    });
    if (trace) along.push(dot(trace.a, d), dot(trace.b, d));
    let from = Math.min(...along);
    let to = Math.max(...along);
    const pad = 0.6 * m;
    from -= pad;
    to += pad;

    // Le banchine si disegnano come una fascia di terra larga 3 m dietro le poppe.
    const lo = quaySide !== 0 ? (quaySide > 0 ? lineAt : lineAt - 3 * m) : lineAt - half;
    const hi = quaySide !== 0 ? (quaySide > 0 ? lineAt + 3 * m : lineAt) : lineAt + half;
    const at = (t: number, s: number): Point => ({ x: d.x * t + n.x * s, y: d.y * t + n.y * s });
    const outline = [at(from, lo), at(to, lo), at(to, hi), at(from, hi)];

    // Il nome va oltre la testata: quella tracciata, o l'estremità più vicina al centro del porto.
    const headAtEnd = trace ? true : Math.abs(dot(center, d) - to) <= Math.abs(dot(center, d) - from);
    const dir = headAtEnd ? d : { x: -d.x, y: -d.y };
    const tip = at(headAtEnd ? to : from, (lo + hi) / 2);
    const gap = 1.5 * m;
    const p = { x: tip.x + dir.x * gap, y: tip.y + dir.y * gap };
    const anchor: PierShape["label"]["anchor"] = Math.abs(dir.x) >= Math.abs(dir.y) * 0.6 ? (dir.x > 0 ? "start" : "end") : "middle";
    shapes.push({ id: pier.id, name: pier.name, outline, label: { ...p, anchor } });
  }

  // Riquadro che contiene posti e pontili, con un margine.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of shapes) {
    for (const p of s.outline) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  for (const b of all) {
    const r = (Math.max(b.lengthCm, b.beamCm) / 200) * m;
    xs.push(b.x - r, b.x + r);
    ys.push(b.y - r, b.y + r);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const margin = Math.max(maxX - minX, maxY - minY) * 0.06 + 4 * m;
  return {
    piers: shapes,
    stern,
    bounds: { x: minX - margin, y: minY - margin, width: maxX - minX + 2 * margin, height: maxY - minY + 2 * margin },
  };
}

/**
 * Sagoma di una barca vista dall'alto, con la prua verso la y negativa e la poppa verso la positiva,
 * centrata nell'origine. `length` e `beam` in pixel.
 */
export function boatPath(length: number, beam: number): string {
  const h = beam / 2;
  const l = length / 2;
  const f = (v: number) => Math.round(v * 100) / 100;
  return [
    `M ${f(-h * 0.82)} ${f(l)}`,
    `L ${f(-h)} ${f(l * 0.1)}`,
    `C ${f(-h)} ${f(-l * 0.45)} ${f(-h * 0.55)} ${f(-l * 0.85)} 0 ${f(-l)}`,
    `C ${f(h * 0.55)} ${f(-l * 0.85)} ${f(h)} ${f(-l * 0.45)} ${f(h)} ${f(l * 0.1)}`,
    `L ${f(h * 0.82)} ${f(l)}`,
    "Z",
  ].join(" ");
}

// Tuga della barca (stesso sistema di riferimento di `boatPath`): un rettangolo arrotondato verso poppa.
export function cabinPath(length: number, beam: number): string {
  const w = beam * 0.5;
  const top = -length * 0.18;
  const bottom = length * 0.22;
  const r = w * 0.35;
  const f = (v: number) => Math.round(v * 100) / 100;
  return [
    `M ${f(-w / 2)} ${f(top + r)}`,
    `Q ${f(-w / 2)} ${f(top)} 0 ${f(top - r * 0.6)}`,
    `Q ${f(w / 2)} ${f(top)} ${f(w / 2)} ${f(top + r)}`,
    `L ${f(w / 2)} ${f(bottom)}`,
    `L ${f(-w / 2)} ${f(bottom)}`,
    "Z",
  ].join(" ");
}
