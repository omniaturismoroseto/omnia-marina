// Posti nuovi su un pontile già disegnato sulla pianta: si dispongono da soli in coda a quelli che ci sono,
// senza ritracciare il pontile (generateBerths in src/server/settings-actions.ts).
import { isAlongside, layoutPier, mooringAlong, rowAxis, type Placement, type Point } from "./plan";

export interface PlacedBerth {
  side: "sx" | "dx";
  position: number;
  x: number;
  y: number;
  angle: number;
  lengthCm: number;
  beamCm: number;
}

export interface NewBerth {
  id: string;
  side: "sx" | "dx";
  position: number;
  lengthCm: number;
  beamCm: number;
}

export interface Trace {
  a: Point;
  b: Point;
  widthM: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
const median = (values: number[]) => {
  const s = [...values].sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const bySlot = <T extends { position: number }>(list: T[]) => [...list].sort((p, q) => p.position - q.position);

/**
 * Posizione sulla foto dei posti nuovi di una struttura (pontile o tratto):
 * - sul lato con posti già disposti proseguono dopo l'ultimo, con la distanza tipica tra i posti, lo stesso angolo e la stessa
 *   distanza dal pontile (corretta per la lunghezza);
 * - su un lato ancora vuoto si mettono di fronte ai posti dell'altro lato, specchiati rispetto alla linea del pontile;
 * - senza posti disposti ma con la linea tracciata si distribuiscono lungo la linea, come quando la si traccia;
 * - senza né posti né linea non si può dire dove vanno: nessuna posizione.
 * Sinistra e destra seguono la regola del tracciamento: «sx» a sinistra di chi va dalla radice alla testata.
 */
export function placeNewBerths(existing: PlacedBerth[], incoming: NewBerth[], trace: Trace | null, pxPerMeter: number): Placement[] {
  const m = pxPerMeter;
  if (incoming.length === 0 || m <= 0) return [];
  const traceLen = trace ? Math.hypot(trace.b.x - trace.a.x, trace.b.y - trace.a.y) : 0;
  const line = trace && traceLen > 1 ? trace : null;

  if (existing.length === 0) {
    if (!line) return [];
    // Posizioni contate dalla radice, lato per lato, solo tra i posti nuovi.
    const slots = (["sx", "dx"] as const).flatMap((side) => bySlot(incoming.filter((b) => b.side === side)).map((b, i) => ({ ...b, position: i })));
    return layoutPier(slots, line.a, line.b, m, line.widthM);
  }

  const sides = { sx: bySlot(existing.filter((b) => b.side === "sx")), dx: bySlot(existing.filter((b) => b.side === "dx")) };

  // Direzione del pontile dalla radice alla testata e origine delle misure.
  let d: Point;
  let origin: Point;
  if (line) {
    d = { x: (line.b.x - line.a.x) / traceLen, y: (line.b.y - line.a.y) / traceLen };
    origin = line.a;
  } else {
    // Direzione dall'orientamento dei posti (di traverso al lato lungo, o lungo il lato lungo se sono all'inglese); i centri dei posti
    // non bastano, perché le barche più lunghe sporgono di più. Dai posti solo il verso: dalla radice alla testata.
    d = rowAxis(existing, m).d;
    const longest = sides.sx.length >= sides.dx.length ? sides.sx : sides.dx;
    const first = longest[0];
    const last = longest[longest.length - 1];
    if ((last.x - first.x) * d.x + (last.y - first.y) * d.y < 0) d = { x: -d.x, y: -d.y };
    origin = bySlot(existing)[0];
  }
  const left = { x: d.y, y: -d.x };
  const along = (p: Point) => (p.x - origin.x) * d.x + (p.y - origin.y) * d.y;
  const across = (p: Point) => (p.x - origin.x) * left.x + (p.y - origin.y) * left.y;
  const halfWidth = ((line?.widthM ?? 2) / 2) * m;
  // All'inglese i posti sporgono dal pontile di metà larghezza e si susseguono a passo di lunghezza.
  const alongside = mooringAlong(existing, d) === "inglese";
  const reach = (b: { lengthCm: number; beamCm: number }) => ((alongside ? b.beamCm : b.lengthCm) / 200) * m;
  const convention = { sx: 1, dx: -1 } as const;

  // Dove passa la linea del pontile, di traverso.
  let lineAt: number;
  if (line) lineAt = 0;
  else if (sides.sx.length && sides.dx.length) lineAt = (mean(sides.sx.map(across)) + mean(sides.dx.map(across))) / 2;
  else {
    const side = sides.sx.length ? "sx" : "dx";
    const list = sides[side];
    lineAt = mean(list.map(across)) - convention[side] * (halfWidth + mean(list.map(reach)));
  }
  const sign = (side: "sx" | "dx"): number => {
    if (sides[side].length) return Math.sign(mean(sides[side].map(across)) - lineAt) || convention[side];
    const other = side === "sx" ? "dx" : "sx";
    if (sides[other].length) return -(Math.sign(mean(sides[other].map(across)) - lineAt) || convention[other]);
    return convention[side];
  };

  // Distanza tipica tra un posto e il successivo dello stesso lato; senza esempi, la larghezza del posto più un margine.
  const gaps = (["sx", "dx"] as const).flatMap((side) =>
    sides[side].slice(1).flatMap((b, i) => {
      const prev = sides[side][i];
      const slots = b.position - prev.position;
      return slots > 0 ? [Math.abs(along(b) - along(prev)) / slots] : [];
    }),
  );
  const maxBeam = Math.max(...[...existing, ...incoming].map((b) => (alongside ? b.lengthCm : b.beamCm)));
  const spacing = gaps.length ? median(gaps) : (maxBeam / 100) * 1.15 * m;
  const traceAngle = (Math.atan2(d.y, d.x) * 180) / Math.PI;

  const result: Placement[] = [];
  for (const side of ["sx", "dx"] as const) {
    const news = bySlot(incoming.filter((b) => b.side === side));
    if (news.length === 0) continue;
    const here = sides[side];
    const other = sides[side === "sx" ? "dx" : "sx"];
    const s = sign(side);
    news.forEach((b, k) => {
      let t: number;
      let off: number;
      let angle: number;
      if (here.length) {
        const last = here[here.length - 1];
        t = along(last) + spacing * (k + 1);
        off = across(last) + s * (reach(b) - reach(last));
        angle = last.angle;
      } else {
        const ref = other[Math.min(k, other.length - 1)];
        t = k < other.length ? along(other[k]) : along(other[other.length - 1]) + spacing * (k - other.length + 1);
        off = lineAt + s * (halfWidth + reach(b));
        angle = ref ? ref.angle : traceAngle;
      }
      result.push({
        id: b.id,
        x: round1(origin.x + d.x * t + left.x * off),
        y: round1(origin.y + d.y * t + left.y * off),
        angle: Math.round(angle * 100) / 100,
      });
    });
  }
  return result;
}

// Dove vanno i posti nuovi di un pontile diviso in tratti: dove sta il posto con la stessa sigla e il numero più alto
// (C13 dopo C12, anche se C12 è in un tratto); senza posti con quella sigla, nell'ultimo tratto. null = il pontile stesso.
export function targetSection<S extends { id: string }>(sections: S[], list: { code: string; sectionId: string | null }[], prefix: string): S | null {
  if (sections.length === 0) return null;
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`, "i");
  let best: { n: number; sectionId: string | null } | null = null;
  for (const b of list) {
    const m = pattern.exec(b.code);
    if (m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), sectionId: b.sectionId };
  }
  if (!best) return sections[sections.length - 1];
  return sections.find((s) => s.id === best.sectionId) ?? null;
}

/**
 * Linea di un pontile (o tratto) mai tracciato, ricavata dai suoi posti disposti: direzione dall'orientamento dei posti,
 * verso dalla radice alla testata secondo le posizioni, lunghezza quanto i posti, a metà tra i due lati (o dietro le poppe
 * se c'è un lato solo). Null senza posti disposti.
 */
export function estimateTrace(existing: PlacedBerth[], pxPerMeter: number): Trace | null {
  const m = pxPerMeter;
  if (existing.length === 0 || m <= 0) return null;
  const axis = rowAxis(existing, m);
  let d = axis.d;
  const sides = { sx: bySlot(existing.filter((b) => b.side === "sx")), dx: bySlot(existing.filter((b) => b.side === "dx")) };
  const longest = sides.sx.length >= sides.dx.length ? sides.sx : sides.dx;
  const first = longest[0];
  const last = longest[longest.length - 1];
  if ((last.x - first.x) * d.x + (last.y - first.y) * d.y < 0) d = { x: -d.x, y: -d.y };
  const left = { x: d.y, y: -d.x };
  const origin = existing[0];
  const along = (p: Point) => (p.x - origin.x) * d.x + (p.y - origin.y) * d.y;
  const across = (p: Point) => (p.x - origin.x) * left.x + (p.y - origin.y) * left.y;
  let lineAt: number;
  if (sides.sx.length && sides.dx.length) lineAt = (mean(sides.sx.map(across)) + mean(sides.dx.map(across))) / 2;
  else {
    const side = sides.sx.length ? "sx" : "dx";
    const list = sides[side];
    lineAt = mean(list.map(across)) - (side === "sx" ? 1 : -1) * (1 + (mean(list.map((b) => (axis.mooring === "inglese" ? b.beamCm : b.lengthCm))) / 200) * m);
  }
  const half = (b: PlacedBerth) => ((axis.mooring === "inglese" ? b.lengthCm : b.beamCm) / 200) * m;
  const ends = existing.flatMap((b) => [along(b) - half(b), along(b) + half(b)]);
  const at = (t: number): Point => ({ x: round1(origin.x + d.x * t + left.x * lineAt), y: round1(origin.y + d.y * t + left.y * lineAt) });
  return { a: at(Math.min(...ends)), b: at(Math.max(...ends)), widthM: 2 };
}

/**
 * Posizioni di tutto un pontile dopo aver cambiato un suo tratto: i tratti (gruppi) uno dopo l'altro, ognuno dalla colonna
 * libera successiva, con dentro le stesse distanze di prima (i posti uno di fronte all'altro restano tali). Serve alla griglia
 * della mappa senza pianta, dove la posizione è la colonna.
 */
export function renumberPier(groups: { id: string; side: "sx" | "dx"; position: number }[][]): Map<string, number> {
  const result = new Map<string, number>();
  const next = { sx: 0, dx: 0 };
  for (const group of groups) {
    if (group.length === 0) continue;
    const offset = Math.max(next.sx, next.dx);
    const min = Math.min(...group.map((b) => b.position));
    for (const b of group) {
      const position = offset + b.position - min;
      result.set(b.id, position);
      next[b.side] = Math.max(next[b.side], position + 1);
    }
  }
  return result;
}

/**
 * Linea abbastanza lunga per `slots` posti larghi `beamPx` (all'inglese: lunghi) (con un piccolo margine tra l'uno e l'altro): se è più corta si allunga
 * dalla parte della testata, così i posti messi tutti su un lato non si sovrappongono. Se basta, resta com'è.
 */
export function fitTrace(trace: Trace, slots: number, beamPx: number): Trace {
  const len = Math.hypot(trace.b.x - trace.a.x, trace.b.y - trace.a.y);
  const needed = slots * beamPx * 1.1;
  if (len < 1 || needed <= len) return trace;
  const k = needed / len;
  return { ...trace, b: { x: round1(trace.a.x + (trace.b.x - trace.a.x) * k), y: round1(trace.a.y + (trace.b.y - trace.a.y) * k) } };
}

/**
 * Linea accorciata ai posti che le restano (per esempio dopo averne fatto un tratto a parte): stessa direzione e stessa
 * posizione di traverso, lunga dal primo all'ultimo posto con la loro larghezza. Senza posti resta com'è.
 */
export function clipTrace(
  trace: Trace,
  berths: { x: number; y: number; beamCm: number; lengthCm?: number; angle?: number }[],
  pxPerMeter: number,
): Trace {
  const len = Math.hypot(trace.b.x - trace.a.x, trace.b.y - trace.a.y);
  if (berths.length === 0 || len < 1) return trace;
  const d = { x: (trace.b.x - trace.a.x) / len, y: (trace.b.y - trace.a.y) / len };
  const ends = berths.flatMap((b) => {
    const t = (b.x - trace.a.x) * d.x + (b.y - trace.a.y) * d.y;
    // All'inglese il posto occupa la sua lunghezza lungo il pontile.
    const span = b.angle !== undefined && b.lengthCm !== undefined && isAlongside(b.angle, d) ? b.lengthCm : b.beamCm;
    const r = (span / 200) * pxPerMeter;
    return [t - r, t + r];
  });
  const at = (t: number) => ({ x: round1(trace.a.x + d.x * t), y: round1(trace.a.y + d.y * t) });
  return { ...trace, a: at(Math.min(...ends)), b: at(Math.max(...ends)) };
}
