// Terra e acqua ricavate dai colori della foto aerea, per lo sfondo dello schema della mappa.
// Funzioni pure: il browser legge i pixel della foto (ridotta) e le passa qui; il risultato sono contorni in pixel della foto.

import type { Point } from "./plan";

export interface LandOptions {
  // Punti sicuramente in acqua (in celle della griglia): dove si prendono i colori dell'acqua e da dove parte il riempimento.
  seeds: Point[];
  // Celle da considerare acqua comunque (per esempio i posti barca, con le barche sopra): 1 = acqua.
  forcedWater?: Uint8Array;
  // Distanza massima di colore (RGB, 0-441) dai colori dell'acqua.
  tolerance?: number;
  // Aree minime in celle: le «isole» di terra più piccole (barche alla fonda, schiuma) diventano acqua,
  // i «buchi» d'acqua più piccoli dentro la terra diventano terra.
  minLandCells?: number;
  minHoleCells?: number;
  // Raggio in celle con cui si chiudono le tacche strette nella terra (per esempio tra un posto e l'altro lungo una banchina).
  closeCells?: number;
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Maschera della terra (1 = terra, 0 = acqua) su una griglia w × h di pixel RGBA. */
export function landMask(rgba: Uint8ClampedArray, w: number, h: number, options: LandOptions): Uint8Array {
  const { seeds, forcedWater, tolerance = 52, minLandCells = 30, minHoleCells = 12, closeCells = 0 } = options;
  const at = (x: number, y: number) => (y * w + x) * 4;

  // Colori dell'acqua: la mediana attorno a ogni punto, scartando i bianchi e i grigi chiari (barche, schiuma, pontili).
  const refs: [number, number, number][] = [];
  for (const s of seeds) {
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const r: number[] = [];
    const g: number[] = [];
    const b: number[] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = at(x, y);
        r.push(rgba[i]);
        g.push(rgba[i + 1]);
        b.push(rgba[i + 2]);
      }
    }
    const c: [number, number, number] = [median(r), median(g), median(b)];
    const grayish = Math.max(...c) - Math.min(...c) < 22;
    if (grayish && c[0] > 165) continue;
    if (!refs.some((q) => dist(q, c) < 8)) refs.push(c);
  }

  const n = w * h;
  const waterLike = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (forcedWater?.[p]) {
      waterLike[p] = 1;
      continue;
    }
    const i = p * 4;
    const c: [number, number, number] = [rgba[i], rgba[i + 1], rgba[i + 2]];
    for (const q of refs) {
      if (dist(q, c) <= tolerance) {
        waterLike[p] = 1;
        break;
      }
    }
  }

  // Acqua = ciò che è collegato ai punti in acqua passando per pixel «color acqua».
  const water = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (water[p] || !waterLike[p]) return;
    water[p] = 1;
    queue[tail++] = p;
  };
  for (const s of seeds) {
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    if (x >= 0 && y >= 0 && x < w && y < h) push(x, y);
  }
  if (forcedWater) for (let p = 0; p < n; p++) if (forcedWater[p]) push(p % w, Math.floor(p / w));
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p - x) / w;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) push(nx, ny);
    }
  }

  const land = new Uint8Array(n);
  for (let p = 0; p < n; p++) land[p] = water[p] ? 0 : 1;
  removeSmall(land, w, h, 1, minLandCells);
  removeSmall(land, w, h, 0, minHoleCells);
  if (closeCells > 0) {
    // Chiusura: allarga la terra e poi la restringe di nuovo; le tacche più strette di 2 × raggio si riempiono.
    spread(land, w, h, closeCells, 1);
    spread(land, w, h, closeCells, 0);
  }
  smooth(land, w, h);
  smooth(land, w, h);
  return land;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Le zone con valore `value` più piccole di `min` celle prendono il valore opposto.
function removeSmall(mask: Uint8Array, w: number, h: number, value: 0 | 1, min: number) {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (seen[start] || mask[start] !== value) continue;
    const cells: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      cells.push(p);
      const x = p % w;
      const y = (p - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!seen[q] && mask[q] === value) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (cells.length < min) for (const p of cells) mask[p] = value ? 0 : 1;
  }
}

// Allarga le celle con valore `value` di `r` celle (quadrato), in due passate separate.
function spread(mask: Uint8Array, w: number, h: number, r: number, value: 0 | 1) {
  const pass = (horizontal: boolean) => {
    const copy = mask.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (copy[y * w + x] === value) continue;
        for (let d = -r; d <= r; d++) {
          const nx = horizontal ? x + d : x;
          const ny = horizontal ? y : y + d;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (copy[ny * w + nx] === value) {
            mask[y * w + x] = value;
            break;
          }
        }
      }
    }
  };
  pass(true);
  pass(false);
}

// Filtro di maggioranza 3 × 3: ammorbidisce i bordi seghettati.
function smooth(mask: Uint8Array, w: number, h: number) {
  const copy = mask.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          sum += copy[ny * w + nx];
          count++;
        }
      }
      mask[y * w + x] = sum * 2 > count ? 1 : 0;
    }
  }
}

// ───────────────────────── Contorni ─────────────────────────

/**
 * Contorni della terra con il metodo dei «marching squares», semplificati.
 * Le coordinate sono in celle della griglia (il centro della cella (i, j) è (i + 0.5, j + 0.5)).
 * Ogni anello porta `land`: true se racchiude terra, false se è un buco d'acqua dentro la terra.
 */
export function landContours(mask: Uint8Array, w: number, h: number, tolerance = 0.9, minArea = 4): { points: Point[]; land: boolean; area: number }[] {
  // Griglia con un bordo d'acqua tutt'intorno: così ogni contorno si chiude.
  const W = w + 2;
  const H = h + 2;
  const v = (x: number, y: number) => (x < 1 || y < 1 || x > w || y > h ? 0 : mask[(y - 1) * w + (x - 1)]);

  // Punti a metà dei lati, in coordinate raddoppiate (interi): chiave = 2x * 100003 + 2y.
  const key = (x2: number, y2: number) => x2 * 100003 + y2;
  const segments: [number, number, number, number][] = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = v(x, y);
      const tr = v(x + 1, y);
      const br = v(x + 1, y + 1);
      const bl = v(x, y + 1);
      const c = tl * 8 + tr * 4 + br * 2 + bl;
      if (c === 0 || c === 15) continue;
      const T: [number, number] = [2 * x + 1, 2 * y];
      const R: [number, number] = [2 * x + 2, 2 * y + 1];
      const B: [number, number] = [2 * x + 1, 2 * y + 2];
      const L: [number, number] = [2 * x, 2 * y + 1];
      const add = (a: [number, number], b: [number, number]) => segments.push([a[0], a[1], b[0], b[1]]);
      switch (c) {
        case 1:
        case 14:
          add(L, B);
          break;
        case 2:
        case 13:
          add(B, R);
          break;
        case 3:
        case 12:
          add(L, R);
          break;
        case 4:
        case 11:
          add(T, R);
          break;
        case 6:
        case 9:
          add(T, B);
          break;
        case 7:
        case 8:
          add(L, T);
          break;
        case 5: // tr + bl: due angoli separati
          add(L, T);
          add(B, R);
          break;
        case 10: // tl + br
          add(T, R);
          add(L, B);
          break;
      }
    }
  }

  // Unisce i segmenti in anelli chiusi: ogni punto di mezzo è condiviso da due segmenti.
  const byPoint = new Map<number, number[]>();
  segments.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const list = byPoint.get(k);
      if (list) list.push(i);
      else byPoint.set(k, [i]);
    }
  });
  const used = new Uint8Array(segments.length);
  const rings: Point[][] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const s = segments[start];
    const ring: [number, number][] = [[s[0], s[1]]];
    let cur: [number, number] = [s[2], s[3]];
    const firstKey = key(s[0], s[1]);
    for (let guard = 0; guard < segments.length + 1; guard++) {
      ring.push(cur);
      const k = key(cur[0], cur[1]);
      if (k === firstKey) break;
      const next = (byPoint.get(k) ?? []).find((i) => !used[i]);
      if (next === undefined) break;
      used[next] = 1;
      const t = segments[next];
      cur = key(t[0], t[1]) === k ? [t[2], t[3]] : [t[0], t[1]];
    }
    // Da coordinate raddoppiate della griglia con bordo a celle della foto.
    rings.push(ring.map(([x2, y2]) => ({ x: x2 / 2 - 0.5, y: y2 / 2 - 0.5 })));
  }

  const simplified = rings
    .map((r) => simplifyRing(r, tolerance))
    .filter((r) => r.length >= 3)
    .map((points) => ({ points, area: Math.abs(signedArea(points)) }))
    .filter((r) => r.area >= minArea);

  // Terra o buco: dipende da quanti altri anelli lo contengono (pari = terra).
  return simplified
    .map((r, i) => {
      const probe = r.points[0];
      let depth = 0;
      simplified.forEach((o, j) => {
        if (j !== i && o.area > r.area && pointInRing(probe, o.points)) depth++;
      });
      return { ...r, land: depth % 2 === 0 };
    })
    .sort((a, b) => b.area - a.area);
}

export function signedArea(points: Point[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function pointInRing(p: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Douglas-Peucker su un anello chiuso (l'ultimo punto ripete il primo, o no).
function simplifyRing(ring: Point[], tolerance: number): Point[] {
  const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : ring;
  if (pts.length < 4) return pts;
  // Si spezza l'anello nel punto più lontano dal primo, così entrambe le metà hanno estremi stabili.
  let far = 0;
  let best = -1;
  pts.forEach((p, i) => {
    const d = (p.x - pts[0].x) ** 2 + (p.y - pts[0].y) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  });
  const a = simplifyLine(pts.slice(0, far + 1), tolerance);
  const b = simplifyLine([...pts.slice(far), pts[0]], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function simplifyLine(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let index = -1;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], first, last);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [first, last];
  const left = simplifyLine(points.slice(0, index + 1), tolerance);
  const right = simplifyLine(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
