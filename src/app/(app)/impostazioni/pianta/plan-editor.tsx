"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { MousePointer2, Plus, Ruler, Spline } from "@/components/icons";
import { PlanZoom } from "@/app/(app)/mappa/plan-zoom";
import { parseMeters } from "@/lib/format";
import {
  berthSizePx,
  distance,
  layoutPier,
  MOORING_LABEL,
  normalizeAngle,
  rowAxis,
  type Mooring,
  type Point,
} from "@/lib/plan";
import { buildDrawing } from "@/lib/plan-drawing";
import { pathOf, type PlanFeature } from "@/lib/plan-features";
import { PIER, SHAPE, WATER } from "@/lib/plan-style";
import { Field, Form, FormMessage, Submit } from "@/components/form";
import { compareCodes } from "@/lib/berth-codes";
import { alignRows, stretchRows } from "@/lib/plan-align";
import { estimateTrace, fitTrace } from "@/lib/plan-extend";
import { assignModules } from "@/lib/plan-modules";
import { MAX_BERTHS_PER_SIDE, planBerths } from "@/lib/plan-analysis";
import { createFromProposals, savePlanLayout } from "@/server/plan-actions";
import { makeBerthSection } from "@/server/settings-actions";

export interface EditorBerth {
  id: string;
  code: string;
  /** Struttura dell'editor: il pontile o, nei pontili uniti, il tratto (vedi planUnits). */
  pierId: string;
  /** Il pontile vero (per «Fai un tratto con questi posti»). */
  realPierId?: string;
  side: "sx" | "dx";
  position: number;
  lengthCm: number;
  beamCm: number;
  x: number | null;
  y: number | null;
  angle: number | null;
  /** Modulo fisso della pianta (vedi src/lib/plan-modules.ts); vuoto = da riconoscere. */
  module: number | null;
}

// select: sposta e ruota i posti · scale: due punti a distanza nota · pier: traccia un pontile · place: posa un posto
// line: ridisegna i posti scelti lungo una linea (due clic) · newpier: disegna un pontile nuovo (due clic, poi i dati)
type Tool = "select" | "scale" | "pier" | "place" | "line" | "newpier";

// Messaggio dell'ultimo salvataggio: dopo un salvataggio i dati del server cambiano e l'editor riparte da quelli (cambia la sua
// `key`), quindi il messaggio passa da qui per restare visibile.
let carriedNotice: { ok: boolean; message: string } | null = null;

export function PlanEditor({
  imageUrl,
  baseUrl = null,
  width,
  height,
  initialPxPerMeter,
  piers,
  initialBerths,
  initialPierId,
  categories = [],
  usedCodes = [],
  features = [],
  zoomTo,
  highlightIds,
  onSelectionChange,
}: {
  imageUrl: string;
  // Base disegnata (stessa inquadratura della foto): si può mettere sotto i posti al posto della foto.
  baseUrl?: string | null;
  width: number;
  height: number;
  initialPxPerMeter: number | null;
  piers: {
    id: string;
    name: string;
    ax?: number | null;
    ay?: number | null;
    bx?: number | null;
    by?: number | null;
    widthM?: number | null;
  }[];
  initialBerths: EditorBerth[];
  /** Pontile o tratto da proporre subito (da «Apri nella pianta» in Pontili e posti). */
  initialPierId?: string;
  /** Categorie dei posti (per «Nuovo pontile»). */
  categories?: { id: string; name: string; maxLengthCm: number; maxBeamCm: number }[];
  /** Sigle dei pontili già usate (per proporne una libera). */
  usedCodes?: string[];
  /** Sfondo dello schema (terra, acqua, edifici, verde), già nell'ordine di disegno: serve senza base disegnata. */
  features?: PlanFeature[];
  /** Strutture (pontili o tratti) da inquadrare all'apertura, es. il pontile aperto in Pontili e posti; vuoto = tutta la pianta. */
  zoomTo?: string[];
  /** Posti da evidenziare in giallo (es. i posti scelti o il tratto aperto in Pontili e posti). */
  highlightIds?: string[];
  /** I posti scelti sulla mappa (il posto toccato e ciò che si sposta con lui, o i posti scelti uno per uno), per mostrarli altrove. */
  onSelectionChange?: (ids: string[]) => void;
}) {
  // I moduli mancanti si riconoscono all'apertura dalle posizioni salvate, poi restano fissi (si salvano con la pianta).
  const [berths, setBerths] = useState(() => withModules(initialBerths, initialPxPerMeter, width));
  // Sotto i posti si parte dalla base disegnata (o, senza, dallo schema ricavato dai posti); la foto dal vero si sceglie.
  const [under, setUnder] = useState<"foto" | "base">(() =>
    baseUrl || (initialPxPerMeter && initialBerths.some((b) => b.x !== null)) ? "base" : "foto",
  );
  // Ormeggio con cui si dispongono i posti tracciando una linea: di prua (perpendicolari) o all'inglese (di fianco).
  const [mooring, setMooring] = useState<Mooring>("punta");
  const [pxPerMeter, setPxPerMeter] = useState(initialPxPerMeter);
  const [tool, setTool] = useState<Tool>(
    initialPxPerMeter ? "select" : "scale",
  );
  const [points, setPoints] = useState<Point[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Si propone il primo pontile che ha dei posti.
  const [pierId, setPierId] = useState(
    piers.find((p) => p.id === initialPierId)?.id ??
      piers.find((p) => initialBerths.some((b) => b.pierId === p.id))?.id ??
      piers[0]?.id ??
      "",
  );
  const [pierWidth, setPierWidth] = useState("2,00");
  const [meters, setMeters] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(() => carriedNotice);
  useEffect(() => {
    carriedNotice = null;
  }, []);
  const [saving, startSaving] = useTransition();
  const svgRef = useRef<SVGSVGElement>(null);
  // Trascinamento: punto di partenza e posizioni iniziali di ciò che si sposta (un posto o tutto il suo pontile).
  const drag = useRef<{
    start: Point;
    orig: Map<string, Point>;
    pierId: string | null;
    trace: { a: Point; b: Point; widthM: number } | null;
    /** Con «scelti»: posto già scelto toccato senza trascinarlo, che al rilascio si toglie dalla scelta. */
    toggleOff?: string | null;
    moved?: boolean;
  } | null>(null);
  // Cosa si sposta e si ruota con «Seleziona»: il singolo posto o tutto il pontile (o banchina) a cui appartiene.
  // Qui un «pontile» è una struttura della pianta (planUnits): nei pontili uniti ogni tratto si sposta da solo.
  // «modulo»: una parte staccata del pontile (posti vicini tra loro), riconosciuta da sola.
  // «scelti»: i posti toccati uno per uno, per spostare insieme parti vicine che la vicinanza non sa distinguere.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sectionLabel, setSectionLabel] = useState("");
  // «Nuovo pontile»: linea disegnata (radice → testata) e dati del pontile da creare.
  const [draft, setDraft] = useState<{ a: Point; b: Point } | null>(null);
  const [draftForm, setDraftForm] = useState(() => {
    const code = freeCode(usedCodes);
    return {
      code,
      name: `Pontile ${code}`,
      nameTouched: false,
      kind: "pontile" as "pontile" | "banchina",
      mooring: "punta" as Mooring,
      left: "10",
      right: "10",
      categoryId: categories[0]?.id ?? "",
    };
  });
  // Ultima linea usata per ridisegnare i posti scelti: serve a «Inverti il lato».
  const [pickedLine, setPickedLine] = useState<{ a: Point; b: Point; flip: boolean; mooring: Mooring } | null>(null);
  const [moveMode, setMoveMode] = useState<"pontile" | "modulo" | "scelti" | "posto">(
    "pontile",
  );
  const lastAngle = useRef(0);
  // Ultimo pontile tracciato: serve a rifarlo con i lati invertiti senza ricliccare sulla foto.
  const [lastTrace, setLastTrace] = useState<{
    pierId: string;
    a: Point;
    b: Point;
    widthM: number;
    flip: boolean;
    mooring: Mooring;
  } | null>(null);
  // Linee tracciate in questa sessione, una per pontile: si salvano per disegnare i pontili nello schema.
  const [traces, setTraces] = useState<
    Record<string, { a: Point; b: Point; widthM: number }>
  >({});
  // Linee già salvate: spostando o ruotando un pontile intero si spostano anche loro.
  const savedTraces = useRef<
    Record<string, { a: Point; b: Point; widthM: number }>
  >(
    Object.fromEntries(
      piers.flatMap((p) =>
        p.ax != null && p.ay != null && p.bx != null && p.by != null
          ? [
              [
                p.id,
                {
                  a: { x: p.ax, y: p.ay },
                  b: { x: p.bx, y: p.by },
                  widthM: p.widthM ?? 2,
                },
              ],
            ]
          : [],
      ),
    ),
  );

  // Unità di disegno: spessori e testi restano proporzionati qualunque sia la dimensione della foto.
  const u = width / 1000;
  // Bordo dei posti: sottile, in proporzione ai metri (0,08 m) e non alla foto, così non copre il posto quando si ingrandisce.
  const line = initialPxPerMeter || pxPerMeter ? 0.08 * (pxPerMeter ?? initialPxPerMeter ?? 1) : 0.6 * u;
  const lit = new Set(highlightIds ?? []);
  const selected = berths.find((b) => b.id === selectedId) ?? null;
  const unplaced = berths.filter((b) => b.x === null);
  const placedCount = berths.length - unplaced.length;
  const sizeOf = (b: EditorBerth) =>
    pxPerMeter ? berthSizePx(b, pxPerMeter) : { w: 14 * u, l: 36 * u };
  const pierBerths = berths.filter((b) => b.pierId === pierId);
  // Posti che si muovono insieme al posto scelto.
  const groupOf = (b: EditorBerth) => {
    if (moveMode === "posto") return [b];
    if (moveMode === "scelti")
      return picked.has(b.id)
        ? berths.filter((x) => picked.has(x.id) && x.x !== null && x.y !== null)
        : [b];
    const unit = berths.filter(
      (x) => x.pierId === b.pierId && x.x !== null && x.y !== null,
    );
    return moveMode === "pontile" ? unit : moduleOf(b, unit);
  };
  // Modulo: i posti della stessa struttura con lo stesso modulo fisso (riconosciuto all'apertura o scelto a mano).
  const moduleOf = (start: EditorBerth, unit: EditorBerth[]) =>
    start.module === null ? [start] : unit.filter((x) => x.module === start.module);
  const group = selected && selected.x !== null ? groupOf(selected) : [];
  const pickedBerths = berths.filter((b) => picked.has(b.id));
  const pickedPiers = new Set(pickedBerths.map((b) => b.realPierId ?? b.pierId));
  const pickedUnits = new Set(pickedBerths.map((b) => b.pierId));
  const groupIds = new Set(group.map((b) => b.id));
  // Chi usa l'editor (Pontili e posti) mostra gli stessi posti scelti anche fuori dalla mappa.
  const selectionKey = [...new Set([...groupIds, ...(selectedId ? [selectedId] : []), ...(moveMode === "scelti" ? picked : [])])].sort().join(",");
  const onSelectionRef = useRef(onSelectionChange);
  useEffect(() => {
    onSelectionRef.current = onSelectionChange;
  });
  useEffect(() => {
    onSelectionRef.current?.(selectionKey ? selectionKey.split(",") : []);
  }, [selectionKey]);
  const selectedPier = selected
    ? piers.find((p) => p.id === selected.pierId)
    : undefined;
  const currentTrace = (id: string) =>
    traces[id] ?? savedTraces.current[id] ?? null;
  const hasBerths = berths.length > 0;

  // Schema dal vivo (senza base disegnata): pontili e posti come sono adesso nell'editor.
  const liveDrawing = useMemo(() => {
    if (baseUrl || !pxPerMeter) return null;
    return buildDrawing(
      piers.map((p) => ({
        id: p.id,
        name: p.name,
        trace: traces[p.id] ?? savedTraces.current[p.id] ?? null,
        berths: berths.flatMap((b) =>
          b.pierId === p.id && b.x !== null && b.y !== null
            ? [{ id: b.id, side: b.side, x: b.x, y: b.y, angle: b.angle ?? 0, lengthCm: b.lengthCm, beamCm: b.beamCm }]
            : [],
        ),
      })),
      pxPerMeter,
    );
  }, [baseUrl, pxPerMeter, piers, berths, traces]);
  const schemaAvailable = Boolean(baseUrl || liveDrawing);

  // Zona da inquadrare: i posti delle strutture scelte (e le loro linee), con un margine di 15 m o di un quarto della zona.
  const zoomKey = zoomTo?.join(",") ?? "";
  const focus = useMemo(() => {
    if (!zoomKey) return null;
    const ids = new Set(zoomKey.split(","));
    const pts: Point[] = [];
    for (const b of initialBerths) {
      if (!ids.has(b.pierId) || b.x === null || b.y === null) continue;
      const r = initialPxPerMeter ? (Math.max(b.lengthCm, b.beamCm) / 200) * initialPxPerMeter : 0;
      pts.push({ x: b.x - r, y: b.y - r }, { x: b.x + r, y: b.y + r });
    }
    for (const p of piers) if (ids.has(p.id) && p.ax != null && p.ay != null && p.bx != null && p.by != null) pts.push({ x: p.ax, y: p.ay }, { x: p.bx, y: p.by });
    if (pts.length === 0) return null;
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const pad = Math.max((initialPxPerMeter ?? 0) * 15, (maxX - minX + maxY - minY) / 8, width / 40);
    return { x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad };
  }, [zoomKey, initialBerths, initialPxPerMeter, piers, width]);

  // Avviso se si chiude la pagina con modifiche non salvate.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function toImage(e: { clientX: number; clientY: number }): Point {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  }

  function update(id: string, patch: Partial<EditorBerth>) {
    setBerths((list) =>
      list.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    );
    setDirty(true);
    setNotice(null);
  }

  // Posti scelti: nuove posizioni (il modulo si riconosce di nuovo, sono in fila).
  // modules: «keep» = ogni posto resta nel suo modulo (cambio di ormeggio, allineamento: i posti all'inglese, distanziati lungo il
  // pontile, per vicinanza sembrerebbero tutti staccati); «one» = i posti diventano un modulo solo (ridisegnati lungo una linea);
  // «recognize» = il modulo si riconosce di nuovo dalla vicinanza.
  function placePicked(
    placements: { id: string; x: number; y: number; angle: number }[],
    message: string,
    modules: "keep" | "one" | "recognize" = "recognize",
  ) {
    if (placements.length === 0) return;
    const byId = new Map(placements.map((pl) => [pl.id, pl]));
    setBerths((list) => {
      // Un modulo nuovo per struttura (i numeri dei moduli valgono dentro la struttura).
      const fresh = new Map<string, number>();
      const newModule = (unit: string) => {
        if (!fresh.has(unit)) fresh.set(unit, nextModule(list, unit));
        return fresh.get(unit)!;
      };
      const moved = list.map((b) => {
        if (!byId.has(b.id)) return b;
        const mod = modules === "one" ? newModule(b.pierId) : modules === "keep" ? (b.module ?? newModule(b.pierId)) : null;
        return { ...b, ...byId.get(b.id)!, module: mod };
      });
      return withModules(moved, pxPerMeter, width);
    });
    setDirty(true);
    setNotice({ ok: true, message });
  }

  // «Allinea in fila»: dritti dove sono, in ordine di codice, a passo uguale (posti scelti, modulo o pontile).
  function alignPicked() {
    alignBerths(berths.filter((b) => picked.has(b.id)));
  }
  function alignBerths(chosen: EditorBerth[]) {
    if (!pxPerMeter) return;
    const list = chosen.filter((b) => b.x !== null && b.y !== null);
    placePicked(
      alignRows(
        list.map((b) => ({ id: b.id, code: b.code, x: b.x!, y: b.y!, angle: b.angle ?? 0, lengthCm: b.lengthCm, beamCm: b.beamCm })),
        pxPerMeter,
      ),
      `${list.length} posti rimessi in fila. Se serve, ritocca e salva la pianta.`,
      "keep",
    );
  }

  // Ormeggio di un gruppo di posti già disposti: «di prua» o «all'inglese» rispetto alla linea del pontile.
  function mooringOf(list: EditorBerth[]): Mooring | null {
    const placed = list.filter((b) => b.x !== null && b.y !== null);
    if (!pxPerMeter || placed.length === 0) return null;
    return rowAxis(placed.map((b) => ({ x: b.x!, y: b.y!, angle: b.angle ?? 0, lengthCm: b.lengthCm, beamCm: b.beamCm })), pxPerMeter).mooring;
  }

  /**
   * Cambia l'ormeggio di posti già disposti senza ritracciare: si ridispongono lungo la loro linea (quella tracciata o, per un
   * modulo o posti scelti, quella ricavata dai posti), dallo stesso lato e nello stesso ordine; all'inglese la linea si allunga
   * verso la testata quanto serve perché le barche non si sovrappongano. `unitId`: tutto il pontile o tratto (la linea si aggiorna).
   */
  function changeMooring(list: EditorBerth[], next: Mooring, unitId: string | null) {
    if (!pxPerMeter) return;
    const placed = list.filter((b) => b.x !== null && b.y !== null);
    if (placed.length === 0) return;
    const asPlaced = placed.map((b) => ({ side: b.side, position: b.position, x: b.x!, y: b.y!, angle: b.angle ?? 0, lengthCm: b.lengthCm, beamCm: b.beamCm }));
    const saved = unitId ? currentTrace(unitId) : null;
    const base = saved ?? estimateTrace(asPlaced, pxPerMeter);
    if (!base) return;
    // Stesso lato di prima: «sx» è a sinistra di chi va dalla radice alla testata, se no la disposizione era invertita.
    const len = Math.hypot(base.b.x - base.a.x, base.b.y - base.a.y) || 1;
    const left = { x: (base.b.y - base.a.y) / len, y: -(base.b.x - base.a.x) / len };
    const sideOf = (b: EditorBerth) => ((b.x! - base.a.x) * left.x + (b.y! - base.a.y) * left.y) * (b.side === "sx" ? 1 : -1);
    const flip = placed.reduce((sum, b) => sum + Math.sign(sideOf(b)), 0) < 0;
    // Posizioni di seguito, lato per lato, nell'ordine di prima.
    const slots = (["sx", "dx"] as const).flatMap((side) =>
      placed
        .filter((b) => b.side === side)
        .sort((p, q) => p.position - q.position || compareCodes(p.code, q.code))
        .map((b, i) => ({ id: b.id, side, position: i, lengthCm: b.lengthCm, beamCm: b.beamCm })),
    );
    const count = Math.max(...slots.map((x) => x.position)) + 1;
    const span = Math.max(...placed.map((b) => (next === "inglese" ? b.lengthCm : b.beamCm)));
    const trace = fitTrace(base, count, (span / 100) * pxPerMeter);
    const placements = layoutPier(slots, trace.a, trace.b, pxPerMeter, trace.widthM, flip, next);
    placePicked(
      placements,
      next === "inglese"
        ? `${placements.length} posti ormeggiati all'inglese, di fianco al pontile. Se sono dalla parte sbagliata premi «Inverti i lati»; poi salva la pianta.`
        : `${placements.length} posti ormeggiati di prua. Se serve, ritocca e salva la pianta.`,
      "keep",
    );
    if (unitId) {
      setTraces((all) => ({ ...all, [unitId]: { a: trace.a, b: trace.b, widthM: trace.widthM } }));
      setLastTrace({ pierId: unitId, a: trace.a, b: trace.b, widthM: trace.widthM, flip, mooring: next });
    }
  }

  // «Ridisegna con una linea»: i posti scelti, in ordine di codice, lungo la linea da a a b, tutti dallo stesso lato.
  function layPickedAlong(a: Point, b: Point, flip: boolean, how: Mooring = mooring) {
    if (!pxPerMeter) return;
    const list = berths.filter((x) => picked.has(x.id)).sort((p, q) => compareCodes(p.code, q.code));
    const placements = layoutPier(
      list.map((x, i) => ({ id: x.id, side: "sx" as const, position: i, lengthCm: x.lengthCm, beamCm: x.beamCm })),
      a,
      b,
      pxPerMeter,
      (parseMeters(pierWidth) ?? 200) / 100,
      flip,
      how,
    );
    setPickedLine({ a, b, flip, mooring: how });
    placePicked(placements, `${list.length} posti ridisegnati lungo la linea. Se sono dalla parte sbagliata premi «Inverti il lato».`, "one");
  }

  function chooseTool(next: Tool) {
    setTool(next);
    setPoints([]);
    setNotice(null);
    if (next !== "select" && next !== "place") setSelectedId(null);
  }

  function onCanvasClick(e: MouseEvent<SVGSVGElement>) {
    const p = toImage(e);
    if (tool === "select") {
      setSelectedId(null);
    } else if (tool === "scale") {
      setPoints((list) => (list.length >= 2 ? [p] : [...list, p]));
    } else if (tool === "place" && selectedId) {
      const placedId = selectedId;
      setBerths((list) =>
        withModules(
          list.map((b) => (b.id === placedId ? { ...b, x: p.x, y: p.y, angle: lastAngle.current, module: null } : b)),
          pxPerMeter,
          width,
        ),
      );
      setDirty(true);
      setNotice(null);
      setTool("select");
    } else if (tool === "newpier") {
      if (points.length === 0) {
        setPoints([p]);
        return;
      }
      setDraft({ a: points[0], b: p });
      setPoints([]);
      setTool("select");
    } else if (tool === "line") {
      if (points.length === 0) {
        setPoints([p]);
        return;
      }
      layPickedAlong(points[0], p, false);
      setPoints([]);
      setTool("select");
    } else if (tool === "pier") {
      if (points.length === 0) {
        setPoints([p]);
        return;
      }
      const width = parseMeters(pierWidth);
      tracePier({
        pierId,
        a: points[0],
        b: p,
        widthM: (width ?? 200) / 100,
        flip: false,
        mooring,
      });
      setPoints([]);
    }
  }

  // Dispone i posti di un pontile lungo la linea a → b.
  function tracePier(trace: {
    pierId: string;
    a: Point;
    b: Point;
    widthM: number;
    flip: boolean;
    mooring: Mooring;
  }) {
    const placements = pxPerMeter
      ? layoutPier(
          berths.filter((b) => b.pierId === trace.pierId),
          trace.a,
          trace.b,
          pxPerMeter,
          trace.widthM,
          trace.flip,
          trace.mooring,
        )
      : [];
    if (placements.length === 0) {
      setNotice({
        ok: false,
        message:
          "Questo pontile non ha posti da disporre: creali prima in «Pontili e posti».",
      });
      return;
    }
    const byId = new Map(placements.map((pl) => [pl.id, pl]));
    // Un pontile appena tracciato è un modulo solo.
    const traced = nextModule(berths, trace.pierId);
    setBerths((list) =>
      list.map((b) => (byId.has(b.id) ? { ...b, ...byId.get(b.id)!, module: traced } : b)),
    );
    lastAngle.current = placements[0].angle;
    setLastTrace(trace);
    setTraces((all) => ({
      ...all,
      [trace.pierId]: { a: trace.a, b: trace.b, widthM: trace.widthM },
    }));
    setDirty(true);
    setNotice({
      ok: true,
      message: trace.flip
        ? `Lati invertiti: ${placements.length} posti spostati dall'altra parte della linea.`
        : `${placements.length} posti disposti ${MOORING_LABEL[trace.mooring]}. Se sono dalla parte sbagliata premi «Inverti i lati»; i singoli posti si ritoccano con «Seleziona».`,
    });
  }

  function applyScale() {
    const m = parseMeters(meters);
    if (points.length !== 2 || !m) return;
    const next = distance(points[0], points[1]) / (m / 100);
    if (!Number.isFinite(next) || next <= 0) return;
    setPxPerMeter(Math.round(next * 1000) / 1000);
    setPoints([]);
    setMeters("");
    setTool("select");
    setDirty(true);
    setNotice({
      ok: true,
      message:
        "Scala impostata: ora i posti compaiono nelle loro dimensioni reali.",
    });
  }

  // Trascinamento di un posto (solo con lo strumento «Seleziona»).
  function onBerthDown(e: PointerEvent<SVGGElement>, b: EditorBerth) {
    if (tool !== "select" || b.x === null || b.y === null) return;
    e.stopPropagation();
    setSelectedId(b.id);
    let moving = groupOf(b);
    let toggleOff: string | null = null;
    if (moveMode === "scelti") {
      if (picked.has(b.id)) toggleOff = b.id;
      else {
        const next = new Set(picked).add(b.id);
        setPicked(next);
        moving = berths.filter((x) => next.has(x.id) && x.x !== null && x.y !== null);
      }
    }
    const whole = moveMode === "pontile";
    drag.current = {
      start: toImage(e),
      orig: new Map(moving.map((x) => [x.id, { x: x.x!, y: x.y! }])),
      pierId: whole ? b.pierId : null,
      trace: whole ? currentTrace(b.pierId) : null,
      toggleOff,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  // Sposta i posti indicati (e, per un pontile intero, la sua linea) di dx, dy rispetto alle posizioni di partenza.
  function translate(
    orig: Map<string, Point>,
    dx: number,
    dy: number,
    pier: {
      id: string;
      trace: { a: Point; b: Point; widthM: number } | null;
    } | null,
  ) {
    setBerths((list) =>
      list.map((b) =>
        orig.has(b.id)
          ? {
              ...b,
              x: clamp(orig.get(b.id)!.x + dx, 0, width),
              y: clamp(orig.get(b.id)!.y + dy, 0, height),
            }
          : b,
      ),
    );
    if (pier?.trace) {
      const t = pier.trace;
      setTraces((all) => ({
        ...all,
        [pier.id]: {
          a: { x: t.a.x + dx, y: t.a.y + dy },
          b: { x: t.b.x + dx, y: t.b.y + dy },
          widthM: t.widthM,
        },
      }));
    }
    setDirty(true);
    setNotice(null);
  }

  function onBerthMove(e: PointerEvent<SVGGElement>) {
    const d = drag.current;
    if (!d) return;
    const p = toImage(e);
    if (Math.abs(p.x - d.start.x) + Math.abs(p.y - d.start.y) > u) d.moved = true;
    translate(
      d.orig,
      p.x - d.start.x,
      p.y - d.start.y,
      d.pierId ? { id: d.pierId, trace: d.trace } : null,
    );
  }

  // Rilascio: con «scelti» un tocco (senza trascinare) su un posto già scelto lo toglie dalla scelta.
  function onBerthUp() {
    const d = drag.current;
    drag.current = null;
    if (d?.toggleOff && !d.moved) {
      const off = d.toggleOff;
      setPicked((prev) => {
        const next = new Set(prev);
        next.delete(off);
        return next;
      });
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!selected || selected.x === null || selected.y === null) return;
    const step = (e.shiftKey ? 10 : 1) * u;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    const whole = moveMode === "pontile";
    translate(
      new Map(group.map((x) => [x.id, { x: x.x!, y: x.y! }])),
      move[0],
      move[1],
      whole
        ? { id: selected.pierId, trace: currentTrace(selected.pierId) }
        : null,
    );
  }

  // Ruota il posto scelto, o tutto il suo pontile attorno al centro dei suoi posti.
  function rotate(delta: number) {
    if (!selected || selected.x === null) return;
    if (moveMode === "posto" || group.length < 2) {
      const angle = normalizeAngle((selected.angle ?? 0) + delta);
      lastAngle.current = angle;
      update(selected.id, { angle });
      return;
    }
    const cx = group.reduce((s, b) => s + b.x!, 0) / group.length;
    const cy = group.reduce((s, b) => s + b.y!, 0) / group.length;
    const r = (delta * Math.PI) / 180;
    const turn = (p: Point): Point => ({
      x:
        Math.round(
          (cx + (p.x - cx) * Math.cos(r) - (p.y - cy) * Math.sin(r)) * 10,
        ) / 10,
      y:
        Math.round(
          (cy + (p.x - cx) * Math.sin(r) + (p.y - cy) * Math.cos(r)) * 10,
        ) / 10,
    });
    setBerths((list) =>
      list.map((b) =>
        groupIds.has(b.id)
          ? {
              ...b,
              ...turn({ x: b.x!, y: b.y! }),
              angle: normalizeAngle((b.angle ?? 0) + delta),
            }
          : b,
      ),
    );
    const t = moveMode === "pontile" ? currentTrace(selected.pierId) : null;
    if (t)
      setTraces((all) => ({
        ...all,
        [selected.pierId]: { a: turn(t.a), b: turn(t.b), widthM: t.widthM },
      }));
    lastAngle.current = normalizeAngle((selected.angle ?? 0) + delta);
    setDirty(true);
    setNotice(null);
  }

  // Allunga (metri > 0) o accorcia il gruppo scelto lungo il pontile: cambia la distanza tra i posti, non le loro misure.
  // «Lunghezza ±»: i posti restano in fila (ogni fila dritta, nello stesso ordine) e non si sovrappongono mai (stretchRows).
  function stretch(meters: number) {
    if (!selected || !pxPerMeter || group.length < 2) return;
    const result = stretchRows(
      group.map((b) => ({ id: b.id, code: b.code, x: b.x!, y: b.y!, angle: b.angle ?? 0, lengthCm: b.lengthCm, beamCm: b.beamCm })),
      pxPerMeter,
      meters,
    );
    if (!result) return;
    const at = new Map(result.placements.map((p) => [p.id, p]));
    setBerths((list) => list.map((b) => (at.has(b.id) ? { ...b, x: at.get(b.id)!.x, y: at.get(b.id)!.y } : b)));
    // La linea salvata del pontile si allunga o accorcia allo stesso modo, dal centro.
    const { d, mid, scale } = result;
    const move = (p: Point): Point => {
      const t = p.x * d.x + p.y * d.y - mid;
      return { x: Math.round((p.x + (scale - 1) * t * d.x) * 10) / 10, y: Math.round((p.y + (scale - 1) * t * d.y) * 10) / 10 };
    };
    const t = moveMode === "pontile" ? currentTrace(selected.pierId) : null;
    if (t)
      setTraces((all) => ({
        ...all,
        [selected.pierId]: { a: move(t.a), b: move(t.b), widthM: t.widthM },
      }));
    setDirty(true);
    setNotice(null);
  }


  // Lunghezza del gruppo scelto lungo il pontile, in metri (dal primo all'ultimo posto, con la loro larghezza).
  const groupLengthM = (() => {
    if (!pxPerMeter || group.length < 2) return null;
    const { d, mooring: how } = rowAxis(group.map((b) => ({ x: b.x!, y: b.y!, angle: b.angle ?? 0, lengthCm: b.lengthCm, beamCm: b.beamCm })), pxPerMeter);
    const proj = group.map((b) => b.x! * d.x + b.y! * d.y);
    const span = Math.max(...group.map((b) => (how === "inglese" ? sizeOf(b).l : sizeOf(b).w)));
    return (Math.max(...proj) - Math.min(...proj) + span) / pxPerMeter;
  })();

  // Posti del pontile disegnato, per l'anteprima sulla foto (stessa regola usata dal server per crearli).
  const draftSides = (["sx", "dx"] as const).flatMap((side) => {
    const count = Math.min(MAX_BERTHS_PER_SIDE, Math.max(0, Number.parseInt(side === "sx" ? draftForm.left : draftForm.right, 10) || 0));
    const category = categories.find((c) => c.id === draftForm.categoryId);
    return count > 0 && category ? [{ side, count, lengthCm: category.maxLengthCm, beamCm: category.maxBeamCm }] : [];
  });
  const draftBerths =
    draft && pxPerMeter && draftForm.code.trim()
      ? planBerths(draftForm.code.trim().toUpperCase(), draftForm.kind, draft.a, draft.b, draftSides, pxPerMeter, draftForm.mooring)
      : [];

  // Disposizione da salvare: posizioni e moduli dei posti, linee tracciate.
  const layoutPayload = () => ({
    pxPerMeter,
    placements: berths.map((b) => ({
      id: b.id,
      position: b.x !== null && b.y !== null ? { x: b.x, y: b.y, angle: b.angle ?? 0 } : null,
      module: b.x !== null && b.y !== null ? b.module : null,
    })),
    traces: Object.entries(traces).map(([pierId, t]) => ({ pierId, ...t })),
  });

  // «Crea il pontile»: salva prima le modifiche in corso, poi crea pontile e posti già disposti lungo la linea.
  function createDraft() {
    if (!draft || !pxPerMeter) return;
    startSaving(async () => {
      if (dirty) {
        const saved = await savePlanLayout(layoutPayload());
        if (!saved.ok) return setNotice(saved);
        setDirty(false);
      }
      const result = await createFromProposals({
        scale: pxPerMeter,
        keepAnalysis: true,
        items: [
          {
            code: draftForm.code.trim().toUpperCase(),
            name: draftForm.name.trim() || `Pontile ${draftForm.code}`,
            kind: draftForm.kind,
            mooring: draftForm.mooring,
            a: draft.a,
            b: draft.b,
            sides: draftSides.map((x) => ({ side: x.side, count: x.count, categoryId: draftForm.categoryId })),
          },
        ],
      });
      setNotice(result);
      if (result.ok) {
        carriedNotice = result;
        setDraft(null);
      }
    });
  }

  function save() {
    startSaving(async () => {
      const result = await savePlanLayout(layoutPayload());
      setNotice(result);
      if (result.ok) {
        carriedNotice = result;
        setDirty(false);
        setTraces({});
      }
    });
  }

  // Scelta dell'ormeggio: di prua (perpendicolari, poppa al pontile) o all'inglese (di fianco, una barca dietro l'altra).
  const mooringPicker = (value: Mooring, onChange: (v: Mooring) => void, id: string) => (
    <div className="grid grid-cols-2 gap-1 rounded-md border border-line bg-white p-0.5 text-sm" role="group" aria-label="Ormeggio" id={id}>
      {(["punta", "inglese"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded px-2 py-1.5 font-medium ${value === v ? "bg-ink text-white" : "text-ink hover:bg-line-soft"}`}
        >
          {v === "punta" ? "Di prua" : "All'inglese"}
        </button>
      ))}
    </div>
  );

  const toolButton = (
    value: Tool,
    label: string,
    Icon: typeof Ruler,
    disabled = false,
  ) => (
    <button
      type="button"
      onClick={() => chooseTool(value)}
      disabled={disabled}
      aria-pressed={tool === value}
      className={`btn btn-sm ${tool === value ? "bg-ink text-white" : "btn-secondary"}`}
    >
      <Icon size={15} aria-hidden="true" />
      {label}
    </button>
  );

  const hint =
    tool === "scale"
      ? points.length < 2
        ? `Clicca sulla foto i due estremi di una distanza che conosci (per esempio un pontile): punto ${points.length + 1} di 2.`
        : "Scrivi qui a fianco quanti metri separano i due punti e premi «Applica»."
      : tool === "newpier"
        ? !pxPerMeter
          ? "Imposta prima la scala."
          : points.length === 0
            ? "Clicca la radice del nuovo pontile (dove si attacca alla banchina)."
            : "Ora clicca la testata: poi, a destra, scegli sigla, posti per lato e categoria e premi «Crea il pontile»."
      : tool === "line"
        ? points.length === 0
          ? "Clicca dove inizia la fila dei posti scelti (il primo codice)."
          : "Ora clicca dove finisce: i posti scelti si rimettono lungo la linea, in ordine di codice."
      : tool === "pier"
        ? !pxPerMeter
          ? "Imposta prima la scala."
          : points.length === 0
            ? "Clicca la radice del pontile scelto (dove si attacca alla banchina)."
            : "Ora clicca la testata del pontile: i suoi posti verranno disposti lungo la linea."
        : tool === "place"
          ? `Clicca sulla foto il punto in cui si trova il posto ${selected?.code ?? ""}.`
          : moveMode === "pontile"
            ? "Trascina un posto per spostare tutto il suo pontile o tratto; trascina la foto per muoverti, rotellina o due dita per ingrandire."
            : moveMode === "modulo"
              ? "Trascina un posto per spostare il suo modulo (la parte staccata del pontile). I moduli restano separati anche se li avvicini; per cambiarli usa «posti scelti» → «Fai un modulo con questi posti»."
              : moveMode === "scelti"
                ? "Tocca i posti da spostare insieme (toccane uno già scelto per toglierlo), poi trascinane uno: si muovono solo quelli scelti, anche se sono vicini ad altri."
              : "Trascina un posto per spostare solo quello; trascina la foto per muoverti, rotellina o due dita per ingrandire.";

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {toolButton("select", "Seleziona", MousePointer2)}
          {toolButton("scale", "Imposta scala", Ruler)}
          {toolButton(
            "pier",
            "Disponi un pontile",
            Spline,
            !pxPerMeter || pierBerths.length === 0,
          )}
          {toolButton("newpier", "Nuovo pontile", Plus, !pxPerMeter || categories.length === 0)}
          <span
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white p-0.5 text-sm"
            role="group"
            aria-label="Cosa spostare"
          >
            <span className="px-1.5 text-muted">Sposta:</span>
            {(["pontile", "modulo", "scelti", "posto"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={moveMode === m}
                onClick={() => {
                  setMoveMode(m);
                  if (m !== "scelti") setPicked(new Set());
                }}
                className={`rounded px-2 py-1 font-medium ${moveMode === m ? "bg-ink text-white" : "text-ink hover:bg-line-soft"}`}
              >
                {m === "pontile"
                  ? "pontile o tratto"
                  : m === "modulo"
                    ? "modulo"
                    : m === "scelti"
                      ? "posti scelti"
                      : "posto singolo"}
              </button>
            ))}
          </span>
          {schemaAvailable && (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-line bg-white p-0.5 text-sm"
              role="group"
              aria-label="Cosa c'è sotto i posti"
            >
              <span className="px-1.5 text-muted">Sotto:</span>
              {(["base", "foto"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={under === v}
                  onClick={() => setUnder(v)}
                  className={`rounded px-2 py-1 font-medium ${under === v ? "bg-ink text-white" : "text-ink hover:bg-line-soft"}`}
                >
                  {v === "foto" ? "Foto dal vero" : baseUrl ? "Base disegnata" : "Schema"}
                </button>
              ))}
            </span>
          )}
        </div>
        <p className="mb-2 min-h-10 text-sm text-muted" aria-live="polite">
          {hint}
        </p>

        {/* Si trascina la foto per muoversi e si ingrandisce con rotellina o due dita (come nella Mappa); le frecce spostano i posti scelti. */}
        <div onKeyDown={onKeyDown} aria-label="Editor della pianta">
          <PlanZoom width={width} height={height} arrowKeys={false} fillScreen focus={focus}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${width} ${height}`}
              style={{
                cursor: tool === "select" ? "default" : "crosshair",
              }}
              className="block h-auto w-full select-none"
              onClick={onCanvasClick}
            >
              {under === "base" && baseUrl ? (
                <image href={baseUrl} width={width} height={height} preserveAspectRatio="none" />
              ) : under === "base" && liveDrawing ? (
                // Schema ricavato dai posti come sono ora: segue le modifiche mentre si lavora.
                <g pointerEvents="none">
                  <rect width={width} height={height} fill={WATER} />
                  {features.map((f) =>
                    f.kind === "servizio" ? null : (
                      <path key={f.id} d={pathOf(f.points)} strokeLinejoin="round" strokeWidth={0.15 * (pxPerMeter ?? 1)} {...SHAPE[f.kind]} />
                    ),
                  )}
                  {liveDrawing.piers.map((p) => (
                    <polygon
                      key={p.id}
                      points={p.outline.map((q) => `${q.x},${q.y}`).join(" ")}
                      fill={PIER.fill}
                      stroke={PIER.stroke}
                      strokeWidth={0.12 * (pxPerMeter ?? 1)}
                      strokeLinejoin="round"
                    />
                  ))}
                </g>
              ) : (
                <image href={imageUrl} width={width} height={height} preserveAspectRatio="none" />
              )}
              {berths.map((b) => {
                if (b.x === null || b.y === null) return null;
                const { w, l } = sizeOf(b);
                const active =
                  b.id === selectedId ||
                  groupIds.has(b.id) ||
                  (moveMode === "scelti" && picked.has(b.id));
                return (
                  <g
                    key={b.id}
                    transform={`translate(${b.x} ${b.y})`}
                    style={{
                      cursor: tool === "select" ? "move" : "inherit",
                      touchAction: tool === "select" ? "none" : "auto",
                    }}
                    onPointerDown={(e) => onBerthDown(e, b)}
                    onPointerMove={onBerthMove}
                    onPointerUp={onBerthUp}
                    onPointerCancel={() => (drag.current = null)}
                    onClick={(e) => tool === "select" && e.stopPropagation()}
                  >
                    <title>{`Posto ${b.code}`}</title>
                    <rect
                      transform={`rotate(${b.angle ?? 0})`}
                      x={-w / 2}
                      y={-l / 2}
                      width={w}
                      height={l}
                      rx={line * 2}
                      fill={active ? "#d4502a" : lit.has(b.id) ? "#e8a317" : "#24497a"}
                      fillOpacity={active || lit.has(b.id) ? 0.85 : 0.6}
                      stroke="#fff"
                      strokeWidth={(active ? 2 : 1) * line}
                    />
                  </g>
                );
              })}
              {draft && (
                <g pointerEvents="none">
                  <line
                    x1={draft.a.x}
                    y1={draft.a.y}
                    x2={draft.b.x}
                    y2={draft.b.y}
                    stroke="#d4502a"
                    strokeWidth={2 * u}
                    strokeDasharray={`${6 * u} ${4 * u}`}
                  />
                  <circle cx={draft.a.x} cy={draft.a.y} r={5 * u} fill="#d4502a" stroke="#fff" strokeWidth={1.5 * u} />
                  {draftBerths.map((b) => {
                    const { w, l } = berthSizePx(b, pxPerMeter ?? 1);
                    return (
                      <rect
                        key={b.code}
                        transform={`translate(${b.placement.x} ${b.placement.y}) rotate(${b.placement.angle})`}
                        x={-w / 2}
                        y={-l / 2}
                        width={w}
                        height={l}
                        rx={u}
                        fill="#d4502a"
                        fillOpacity={0.35}
                        stroke="#d4502a"
                        strokeWidth={1.2 * u}
                      />
                    );
                  })}
                </g>
              )}
              {points.length === 2 && (
                <line
                  x1={points[0].x}
                  y1={points[0].y}
                  x2={points[1].x}
                  y2={points[1].y}
                  stroke="#d4502a"
                  strokeWidth={2 * u}
                  strokeDasharray={`${6 * u} ${4 * u}`}
                  pointerEvents="none"
                />
              )}
              {points.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={5 * u}
                  fill="#d4502a"
                  stroke="#fff"
                  strokeWidth={1.5 * u}
                  pointerEvents="none"
                />
              ))}
            </svg>
          </PlanZoom>
        </div>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6">
        {draft && (
          <section className="card space-y-3 border-buoy/40 p-4">
            <h3 className="text-[15px] font-semibold text-ink">Nuovo pontile</h3>
            <p className="text-sm text-muted">
              Linea disegnata dalla radice (pallino) alla testata. I posti si numerano dalla radice: prima il lato sinistro, poi il destro.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="np-code" className="label">
                  Sigla
                </label>
                <input
                  id="np-code"
                  className="input"
                  maxLength={4}
                  value={draftForm.code}
                  onChange={(e) => {
                    const code = e.target.value.toUpperCase();
                    setDraftForm((f) => ({ ...f, code, name: f.nameTouched ? f.name : `${f.kind === "banchina" ? "Banchina" : "Pontile"} ${code}` }));
                  }}
                />
              </div>
              <div>
                <label htmlFor="np-kind" className="label">
                  Tipo
                </label>
                <select
                  id="np-kind"
                  className="input"
                  value={draftForm.kind}
                  onChange={(e) => {
                    const kind = e.target.value as "pontile" | "banchina";
                    setDraftForm((f) => ({
                      ...f,
                      kind,
                      right: kind === "banchina" ? "0" : f.right,
                      name: f.nameTouched ? f.name : `${kind === "banchina" ? "Banchina" : "Pontile"} ${f.code}`,
                    }));
                  }}
                >
                  <option value="pontile">Pontile</option>
                  <option value="banchina">Banchina</option>
                </select>
              </div>
            </div>
            <div>
              <span className="label">Ormeggio</span>
              {mooringPicker(draftForm.mooring, (v) => setDraftForm((f) => ({ ...f, mooring: v })), "np-mooring")}
            </div>
            <div>
              <label htmlFor="np-name" className="label">
                Nome
              </label>
              <input id="np-name" className="input" value={draftForm.name} onChange={(e) => setDraftForm((f) => ({ ...f, name: e.target.value, nameTouched: true }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="np-left" className="label">
                  Posti a sinistra
                </label>
                <input id="np-left" className="input" inputMode="numeric" value={draftForm.left} onChange={(e) => setDraftForm((f) => ({ ...f, left: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="np-right" className="label">
                  Posti a destra
                </label>
                <input id="np-right" className="input" inputMode="numeric" value={draftForm.right} onChange={(e) => setDraftForm((f) => ({ ...f, right: e.target.value }))} />
              </div>
            </div>
            <div>
              <label htmlFor="np-cat" className="label">
                Categoria
              </label>
              <select id="np-cat" className="input" value={draftForm.categoryId} onChange={(e) => setDraftForm((f) => ({ ...f, categoryId: e.target.value }))}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="hint">
              {draftBerths.length === 0
                ? "Indica quanti posti per lato."
                : `${draftBerths.length} posti: ${draftBerths[0].code}–${draftBerths[draftBerths.length - 1].code}. Sinistra e destra sono quelle di chi va dalla radice alla testata.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary btn-sm" disabled={saving || draftBerths.length === 0 || !draftForm.code.trim()} onClick={createDraft}>
                {saving ? "Attendere…" : "Crea il pontile"}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft({ a: draft.b, b: draft.a })}>
                Inverti radice e testata
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
                Annulla
              </button>
            </div>
            {dirty && <p className="hint">Prima di crearlo salvo le modifiche alla pianta che hai fatto.</p>}
          </section>
        )}
        <section className="card p-4">
          <h3 className="text-[15px] font-semibold text-ink">Scala</h3>
          <p className="mt-1 text-sm text-muted">
            {pxPerMeter
              ? `1 metro = ${pxPerMeter.toLocaleString("it-IT", { maximumFractionDigits: 2 })} pixel della foto.`
              : "Non ancora impostata: serve per disegnare i posti nelle misure reali."}
          </p>
          {tool === "scale" && points.length === 2 && (
            <div className="mt-3 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor="plan-meters" className="label">
                  Distanza reale (m)
                </label>
                <input
                  id="plan-meters"
                  className="input"
                  inputMode="decimal"
                  placeholder="Es. 42,50"
                  value={meters}
                  onChange={(e) => setMeters(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyScale()}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!parseMeters(meters)}
                onClick={applyScale}
              >
                Applica
              </button>
            </div>
          )}
        </section>

        <section className="card p-4">
          <h3 className="text-[15px] font-semibold text-ink">
            Disponi un pontile
          </h3>
          <p className="mt-1 text-sm text-muted">
            Scegli il pontile, poi tracciane l&apos;asse sulla foto con due
            clic: dalla radice alla testata.
          </p>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="plan-pier" className="label">
                Pontile o tratto (posti già disposti)
              </label>
              <select
                id="plan-pier"
                className="input"
                value={pierId}
                onChange={(e) => setPierId(e.target.value)}
              >
                {piers.map((p) => {
                  const list = berths.filter((b) => b.pierId === p.id);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} ({list.filter((b) => b.x !== null).length} di{" "}
                      {list.length})
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label htmlFor="plan-pier-width" className="label">
                Larghezza del pontile (m)
              </label>
              <input
                id="plan-pier-width"
                className="input"
                inputMode="decimal"
                value={pierWidth}
                onChange={(e) => setPierWidth(e.target.value)}
              />
            </div>
            <div>
              <span className="label">Ormeggio</span>
              {mooringPicker(mooring, (v) => {
                setMooring(v);
                // Il pontile scelto, se è già disposto, cambia subito ormeggio (senza ritracciarlo).
                const unit = berths.filter((b) => b.pierId === pierId);
                const now = mooringOf(unit);
                if (now && now !== v) changeMooring(unit, v, pierId);
              }, "plan-mooring")}
            </div>
            <button
              type="button"
              className="btn btn-secondary w-full"
              disabled={!pxPerMeter || pierBerths.length === 0}
              onClick={() => chooseTool("pier")}
            >
              Traccia il pontile sulla foto
            </button>
            {!pxPerMeter && hasBerths && (
              <p className="hint">Prima imposta la scala.</p>
            )}
            {pxPerMeter && pierId && pierBerths.length === 0 && hasBerths && (
              <p className="hint">Questo pontile non ha ancora posti.</p>
            )}
            {lastTrace && lastTrace.pierId === pierId && (
              <button
                type="button"
                className="btn btn-ghost w-full"
                onClick={() =>
                  tracePier({ ...lastTrace, flip: !lastTrace.flip })
                }
              >
                Inverti i lati
              </button>
            )}
            <p className="hint">
              Per una banchina, traccia la linea lungo il bordo del molo e metti
              larghezza 0. «All&apos;inglese»: le barche si ormeggiano di fianco
              al pontile, una dietro l&apos;altra. Se il pontile scelto è già
              disposto cambia subito; vale anche per «Ridisegna con una linea».
            </p>
          </div>
        </section>

        {moveMode === "scelti" && (
          <section className="card space-y-3 p-4">
            <h3 className="text-[15px] font-semibold text-ink">
              Posti scelti{" "}
              <span className="font-normal text-muted">({pickedBerths.length})</span>
            </h3>
            {pickedBerths.length === 0 ? (
              <p className="text-sm text-muted">
                Tocca sulla foto i posti da spostare insieme. Servono quando due parti sono così vicine che «modulo» le
                prende insieme.
              </p>
            ) : (
              <p className="text-sm text-muted">
                {pickedBerths
                  .map((b) => b.code)
                  .slice(0, 14)
                  .join(", ")}
                {pickedBerths.length > 14 ? "…" : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!selected || selected.x === null}
                onClick={() => {
                  if (!selected || selected.x === null) return;
                  const unit = berths.filter((x) => x.pierId === selected.pierId && x.x !== null && x.y !== null);
                  setPicked((prev) => new Set([...prev, ...moduleOf(selected, unit).map((x) => x.id)]));
                }}
              >
                + il suo modulo
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!selected}
                onClick={() =>
                  selected &&
                  setPicked(
                    (prev) =>
                      new Set([
                        ...prev,
                        ...berths.filter((x) => x.pierId === selected.pierId && x.x !== null).map((x) => x.id),
                      ]),
                  )
                }
              >
                + tutto il pontile o tratto
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={pickedBerths.length === 0} onClick={() => setPicked(new Set())}>
                Nessuno
              </button>
            </div>
            {pickedBerths.length > 0 && (
              <div className="space-y-2 border-t border-line-soft pt-3">
                <p className="label">Rimetti in ordine</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!pxPerMeter || pickedBerths.filter((b) => b.x !== null).length < 2} onClick={alignPicked}>
                    Allinea in fila
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!pxPerMeter}
                    onClick={() => {
                      setTool("line");
                      setPoints([]);
                      setNotice(null);
                    }}
                  >
                    Ridisegna con una linea
                  </button>
                  {pickedLine && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => layPickedAlong(pickedLine.a, pickedLine.b, !pickedLine.flip, pickedLine.mooring)}>
                      Inverti il lato
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-bad"
                    onClick={() => {
                      setBerths((list) => list.map((b) => (picked.has(b.id) ? { ...b, x: null, y: null, angle: null, module: null } : b)));
                      setPicked(new Set());
                      setDirty(true);
                      setNotice({ ok: true, message: "Posti tolti dalla pianta: li ritrovi in «Da disporre»." });
                    }}
                  >
                    Togli dalla pianta
                  </button>
                </div>
                <p className="hint">
                  «Allinea in fila» li raddrizza dove sono: stessa linea, stesso angolo, stessa distanza, in ordine di codice. «Ridisegna con
                  una linea»: clicca inizio e fine sulla foto e si rimettono lungo la linea (larghezza della passerella: quella di «Disponi un
                  pontile»).
                </p>
              </div>
            )}
            {pickedBerths.length > 0 && (
              <div className="border-t border-line-soft pt-3">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={pickedUnits.size !== 1}
                  onClick={() => {
                    const unit = pickedBerths[0].pierId;
                    const made = nextModule(berths, unit);
                    setBerths((list) => list.map((b) => (picked.has(b.id) ? { ...b, module: made } : b)));
                    setMoveMode("modulo");
                    setPicked(new Set());
                    setDirty(true);
                    setNotice({ ok: true, message: `Modulo di ${pickedBerths.length} posti: ora con «modulo» si spostano insieme. Ricordati di salvare la pianta.` });
                  }}
                >
                  Fai un modulo con questi posti
                </button>
                <p className="hint mt-1">
                  {pickedUnits.size !== 1
                    ? "Un modulo si fa con posti dello stesso pontile o tratto."
                    : "Con «modulo» si sposteranno sempre insieme, separati dagli altri anche se li avvicini."}
                </p>
              </div>
            )}
            {pickedBerths.length > 0 && (
              <div className="border-t border-line-soft pt-3">
                <p className="label">Separali per sempre</p>
                {pickedPiers.size > 1 ? (
                  <p className="text-sm text-muted">
                    I posti scelti sono su pontili diversi: un tratto si fa con posti di un solo pontile.
                  </p>
                ) : dirty ? (
                  <p className="text-sm text-muted">
                    Salva prima la pianta, poi crea il tratto: da quel momento quei posti si spostano da soli anche con «pontile o
                    tratto».
                  </p>
                ) : (
                  <Form action={makeBerthSection} className="space-y-2">
                    <input type="hidden" name="pierId" value={[...pickedPiers][0] ?? ""} />
                    <input type="hidden" name="berthIds" value={pickedBerths.map((b) => b.id).join(",")} />
                    <Field
                      name="label"
                      label="Nome del tratto"
                      value={sectionLabel || commonLetters(pickedBerths)}
                      onChange={(e) => setSectionLabel(e.target.value)}
                      maxLength={20}
                      required
                    />
                    <Submit variant="secondary" size="sm">
                      Fai un tratto con questi posti
                    </Submit>
                    <FormMessage />
                    <p className="hint">
                      Da quel momento si spostano, ruotano e tracciano da soli, anche con «pontile o tratto»; nella scheda del
                      pontile compaiono come tratto a sé.
                    </p>
                  </Form>
                )}
              </div>
            )}
          </section>
        )}

        {selected && (
          <section className="card p-4">
            <h3 className="text-[15px] font-semibold text-ink">
              {moveMode !== "posto" && group.length > 1
                ? moveMode === "scelti"
                  ? "Ruota e allunga i posti scelti"
                  : `${moveMode === "modulo" ? "Modulo di " : ""}${selectedPier?.name ?? "Pontile"} (${group.length} posti)`
                : `Posto ${selected.code}`}
            </h3>
            {selected.x === null ? (
              <p className="mt-1 text-sm text-muted">
                Clicca sulla foto per posarlo.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  {moveMode !== "posto" && group.length > 1 ? (
                    <p className="label">
                      {moveMode === "modulo"
                        ? "Ruota il modulo"
                        : moveMode === "scelti"
                          ? "Ruota i posti scelti"
                          : "Ruota tutto il pontile"}
                    </p>
                  ) : (
                    <>
                      <label htmlFor="plan-angle" className="label">
                        Rotazione: {Math.round(selected.angle ?? 0)}°
                      </label>
                      <input
                        id="plan-angle"
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={selected.angle ?? 0}
                        onChange={(e) => {
                          lastAngle.current = Number(e.target.value);
                          update(selected.id, {
                            angle: Number(e.target.value),
                          });
                        }}
                        className="w-full accent-sea"
                      />
                    </>
                  )}
                  <div className="mt-1 flex gap-1">
                    {[-90, -5, -1, 1, 5, 90].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className="btn btn-secondary btn-sm flex-1 px-1"
                        onClick={() => rotate(d)}
                      >
                        {d > 0 ? `+${d}°` : `${d}°`}
                      </button>
                    ))}
                  </div>
                </div>
                {moveMode !== "posto" &&
                  group.length > 1 &&
                  groupLengthM !== null && (
                    <div>
                      <p className="label">
                        Lunghezza:{" "}
                        {groupLengthM.toLocaleString("it-IT", {
                          maximumFractionDigits: 1,
                        })}{" "}
                        m
                      </p>
                      <div className="mt-1 flex gap-1">
                        {[-5, -1, 1, 5].map((m) => (
                          <button
                            key={m}
                            type="button"
                            className="btn btn-secondary btn-sm flex-1 px-1"
                            onClick={() => stretch(m)}
                          >
                            {m > 0 ? `+${m} m` : `${m} m`}
                          </button>
                        ))}
                      </div>
                      <p className="hint mt-1">
                        Allunga o accorcia cambiando lo spazio tra i posti; le
                        misure dei posti restano le stesse.
                      </p>
                    </div>
                  )}
                {moveMode !== "posto" && group.length > 1 && (
                  <div>
                    <span className="label">Ormeggio</span>
                    {mooringPicker(
                      mooringOf(group) ?? "punta",
                      (v) => {
                        if (v === mooringOf(group)) return;
                        setMooring(v);
                        changeMooring(group, v, moveMode === "pontile" ? selected.pierId : null);
                      },
                      "group-mooring",
                    )}
                    <p className="hint mt-1">
                      «All&apos;inglese» gira le barche di fianco al pontile, una dietro l&apos;altra, sulla stessa linea e dallo stesso lato.
                    </p>
                  </div>
                )}
                {(moveMode === "modulo" || moveMode === "pontile") && group.length > 1 && (
                  <div>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={!pxPerMeter} onClick={() => alignBerths(group)}>
                      Allinea in fila
                    </button>
                    <p className="hint mt-1">
                      Raddrizza {moveMode === "modulo" ? "il modulo" : "il pontile"} dove si trova: stessa linea, stesso angolo, stessa
                      distanza tra i posti, in ordine di codice.
                    </p>
                  </div>
                )}
                {moveMode === "pontile" && group.length > 1 && new Set(group.map((b) => b.module)).size > 1 && (
                  <div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        const ids = new Set(group.map((b) => b.id));
                        const unit = selected.pierId;
                        setBerths((list) => {
                          const mod = nextModule(list, unit);
                          return list.map((b) => (ids.has(b.id) ? { ...b, module: mod } : b));
                        });
                        setDirty(true);
                        setNotice({ ok: true, message: `${ids.size} posti ora sono un modulo solo. Salva la pianta per tenerlo.` });
                      }}
                    >
                      Rimetti in un modulo solo
                    </button>
                    <p className="hint mt-1">
                      Il pontile è diviso in {new Set(group.map((b) => b.module)).size} moduli: se è un pezzo unico (per esempio dopo il cambio di
                      ormeggio) riuniscili.
                    </p>
                  </div>
                )}
                {moveMode === "modulo" && (
                  <div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        const unit = selected.pierId;
                        const again = withModules(
                          berths.map((b) => (b.pierId === unit ? { ...b, module: null } : b)),
                          pxPerMeter,
                          width,
                        );
                        setBerths(again);
                        const count = new Set(again.filter((b) => b.pierId === unit && b.module !== null).map((b) => b.module)).size;
                        setDirty(true);
                        setNotice({ ok: true, message: `Moduli riconosciuti di nuovo: ${count === 1 ? "1 modulo" : `${count} moduli`}. Salva la pianta per tenerli.` });
                      }}
                    >
                      Riconosci di nuovo i moduli
                    </button>
                    <p className="hint mt-1">
                      Rifà i moduli di questo pontile (o tratto) dalle posizioni attuali: fila per fila, uno accanto all&apos;altro o di
                      fronte sulla stessa passerella. Per sistemarne uno a mano usa «posti scelti» → «Fai un modulo con questi posti».
                    </p>
                  </div>
                )}
                {(moveMode === "posto" || group.length < 2) && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() =>
                      update(selected.id, { x: null, y: null, angle: null, module: null })
                    }
                  >
                    Togli dalla pianta
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        <section className="card p-4">
          <h3 className="text-[15px] font-semibold text-ink">
            Da disporre{" "}
            <span className="font-normal text-muted">({unplaced.length})</span>
          </h3>
          {!hasBerths ? (
            <p className="mt-1 text-sm text-muted">
              Non ci sono ancora posti barca. Intanto puoi impostare la scala;
              poi crea pontili e posti in{" "}
              <a href="/impostazioni/pontili" className="link">
                Pontili e posti
              </a>{" "}
              e torna qui per disporli.
            </p>
          ) : unplaced.length === 0 ? (
            <p className="mt-1 text-sm text-muted">
              Tutti i {berths.length} posti sono sulla pianta.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">
                Tocca un posto e poi il punto della foto in cui si trova.
              </p>
              <ul className="mt-2 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                {unplaced.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className={`rounded border px-2 py-0.5 text-sm font-medium tabular-nums ${b.id === selectedId ? "border-buoy bg-buoy-soft text-buoy-dark" : "border-line bg-white text-ink hover:border-sea"}`}
                      onClick={() => {
                        setSelectedId(b.id);
                        setTool("place");
                        setPoints([]);
                      }}
                    >
                      {b.code}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <div className="space-y-2">
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={saving || !dirty}
            onClick={save}
          >
            {saving
              ? "Salvataggio…"
              : dirty
                ? "Salva la pianta"
                : "Nessuna modifica da salvare"}
          </button>
          <p className="text-center text-xs text-muted">
            {placedCount} di {berths.length} posti disposti
          </p>
          {notice && (
            <p
              role={notice.ok ? "status" : "alert"}
              className={`rounded-md px-3 py-2 text-sm ${notice.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}
            >
              {notice.message}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Lettere comuni ai codici (CN1, CN2 → CN): nome proposto per il tratto.
function commonLetters(list: { code: string }[]): string {
  const letters = list.map((b) => b.code.replace(/\d+$/, ""));
  return letters.every((l) => l === letters[0]) ? (letters[0] ?? "") : "";
}

// Riconosce i moduli dei posti disposti che non ne hanno ancora uno (vedi assignModules); gli altri restano come sono.
function withModules(list: EditorBerth[], pxPerMeter: number | null, width: number): EditorBerth[] {
  if (!list.some((b) => b.module === null && b.x !== null && b.y !== null)) return list;
  const meter = pxPerMeter ?? (width / 1000) * 4;
  const size = (b: EditorBerth) => (pxPerMeter ? berthSizePx(b, pxPerMeter) : { w: 14 * (width / 1000), l: 36 * (width / 1000) });
  const modules = assignModules(
    list.flatMap((b) => (b.x !== null && b.y !== null ? [{ id: b.id, unit: b.pierId, x: b.x, y: b.y, angle: b.angle ?? 0, ...size(b), module: b.module }] : [])),
    meter,
  );
  return list.map((b) => (modules.has(b.id) && b.module !== modules.get(b.id) ? { ...b, module: modules.get(b.id)! } : b));
}

// Primo numero di modulo libero in una struttura.
function nextModule(list: EditorBerth[], unit: string): number {
  return list.filter((b) => b.pierId === unit).reduce((max, b) => Math.max(max, b.module ?? 0), 0) + 1;
}

// Prima sigla libera (A, B, C…; poi P1, P2…) per un pontile nuovo.
function freeCode(used: string[]): string {
  const taken = new Set(used.map((c) => c.toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i);
    if (!taken.has(c)) return c;
  }
  let n = 1;
  while (taken.has(`P${n}`)) n++;
  return `P${n}`;
}
