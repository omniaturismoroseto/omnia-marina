"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { Minus, MousePointer2, Plus, RotateCcw, Spline } from "@/components/icons";
import { compareCodes } from "@/lib/berth-codes";
import { berthSizePx, layoutPier, normalizeAngle, rowAxis, type Point } from "@/lib/plan";
import { buildDrawing } from "@/lib/plan-drawing";
import { fitTrace } from "@/lib/plan-extend";
import { alignRows, stretchRows } from "@/lib/plan-align";
import { pathOf } from "@/lib/plan-features";
import { PIER, SHAPE, WATER } from "@/lib/plan-style";
import { addParkingToRow, removeParkingFromRow, saveParkingLayout } from "@/server/parking-actions";
import type { PlanMapData } from "@/server/plan-map";
import { ParkingMarks } from "../../mappa/parking-marks";
import { PlanZoom } from "../../mappa/plan-zoom";

export interface EditorParking {
  id: string;
  code: string;
  covered: boolean;
  lengthCm: number;
  widthCm: number;
  active: boolean;
  x: number | null;
  y: number | null;
  angle: number | null;
}

// select: sceglie e trascina · place: posa i posti scelti con un clic ciascuno · row: mette in fila i posti scelti lungo una linea (due clic)
type Tool = "select" | "place" | "row";

/**
 * Posti auto sulla mappa del porto: si posano con un clic, si mettono in fila lungo una linea, si trascinano e ruotano.
 * Sotto: la base disegnata (o lo schema) con i posti barca in trasparenza; «Foto dal vero» si sceglie. Misure vere dalla scala.
 */
// Dopo «Aggiungi un posto» e «Togli» la pagina si ricarica e l'editor riparte dai dati nuovi: messaggio e posti scelti passano da qui.
let carried: { notice: { ok: boolean; message: string }; selected: string[] } | null = null;

export function ParkingEditor({ map, imageUrl, initial }: { map: PlanMapData; imageUrl: string; initial: EditorParking[] }) {
  const m = map.pxPerMeter;
  const [spaces, setSpaces] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(carried?.selected ?? []));
  const [tool, setTool] = useState<Tool>("select");
  const [points, setPoints] = useState<Point[]>([]);
  const [lastRow, setLastRow] = useState<{ a: Point; b: Point; flip: boolean; ids: string[] } | null>(null);
  const [under, setUnder] = useState<"base" | "foto">("base");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(() => carried?.notice ?? null);
  useEffect(() => {
    carried = null;
  }, []);
  const [saving, startSaving] = useTransition();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ start: Point; orig: Map<string, Point>; moved: boolean } | null>(null);
  const lastAngle = useRef(0);
  const drawing = useMemo(() => buildDrawing(map.piers, m), [map, m]);

  const byCode = (list: EditorParking[]) => [...list].sort((a, b) => compareCodes(a.code, b.code));
  const chosen = byCode(spaces.filter((s) => selected.has(s.id)));
  const unplaced = byCode(spaces.filter((s) => s.x === null));

  // Avviso se si chiude la pagina con modifiche non salvate.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function toImage(e: { clientX: number; clientY: number }): Point {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  }

  function change(next: (list: EditorParking[]) => EditorParking[], message: string | null = null) {
    setSpaces(next);
    setDirty(true);
    setNotice(message ? { ok: true, message } : null);
  }

  function chooseTool(next: Tool) {
    setTool(next);
    setPoints([]);
    setNotice(null);
  }

  // Posti in fila lungo la linea a → b, in ordine di codice, uno accanto all'altro, dal lato sinistro (al contrario con flip).
  function layRow(ids: string[], a: Point, b: Point, flip: boolean) {
    const list = byCode(spaces.filter((s) => ids.includes(s.id)));
    if (list.length === 0) return;
    const width = Math.max(...list.map((s) => s.widthCm));
    const line = fitTrace({ a, b, widthM: 0 }, list.length, (width / 100) * m);
    const placements = layoutPier(
      list.map((s, i) => ({ id: s.id, side: "sx" as const, position: i, lengthCm: s.lengthCm, beamCm: s.widthCm })),
      line.a,
      line.b,
      m,
      0,
      flip,
    );
    const at = new Map(placements.map((p) => [p.id, p]));
    lastAngle.current = placements[0]?.angle ?? 0;
    setLastRow({ a, b, flip, ids });
    change(
      (all) => all.map((s) => (at.has(s.id) ? { ...s, ...at.get(s.id)! } : s)),
      `${list.length} posti auto in fila. Se sono dalla parte sbagliata della linea premi «Inverti il lato».`,
    );
  }

  function onCanvasClick(e: MouseEvent<SVGSVGElement>) {
    const p = toImage(e);
    if (tool === "select") {
      setSelected(new Set());
    } else if (tool === "place") {
      // Il prossimo posto scelto ancora da disporre; senza scelta, il primo da disporre.
      const next = chosen.find((s) => s.x === null) ?? (chosen.length === 0 ? unplaced[0] : undefined);
      if (!next) {
        setNotice({ ok: true, message: "Posti posati. Ora puoi trascinarli, ruotarli o salvare." });
        setTool("select");
        return;
      }
      change((all) => all.map((s) => (s.id === next.id ? { ...s, x: p.x, y: p.y, angle: lastAngle.current } : s)));
      setSelected((prev) => new Set(prev).add(next.id));
    } else if (tool === "row") {
      if (points.length === 0) return setPoints([p]);
      layRow(
        chosen.map((s) => s.id),
        points[0],
        p,
        false,
      );
      setPoints([]);
      setTool("select");
    }
  }

  function onSpaceDown(e: PointerEvent<SVGGElement>, s: EditorParking) {
    if (tool !== "select" || s.x === null || s.y === null) return;
    e.stopPropagation();
    let group = selected;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      group = new Set(selected);
      if (group.has(s.id)) group.delete(s.id);
      else group.add(s.id);
    } else if (!selected.has(s.id)) {
      group = new Set([s.id]);
    }
    setSelected(group);
    const moving = spaces.filter((x) => group.has(x.id) && x.x !== null && x.y !== null);
    drag.current = { start: toImage(e), orig: new Map(moving.map((x) => [x.id, { x: x.x!, y: x.y! }])), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onSpaceMove(e: PointerEvent<SVGGElement>) {
    const d = drag.current;
    if (!d) return;
    const p = toImage(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 0.2 * m) return;
    d.moved = true;
    setSpaces((all) => all.map((s) => (d.orig.has(s.id) ? { ...s, x: Math.round((d.orig.get(s.id)!.x + dx) * 10) / 10, y: Math.round((d.orig.get(s.id)!.y + dy) * 10) / 10 } : s)));
    setDirty(true);
  }

  // Ruota i posti scelti attorno al loro centro comune.
  function rotate(deg: number) {
    const list = chosen.filter((s) => s.x !== null && s.y !== null);
    if (list.length === 0) return;
    const cx = list.reduce((sum, s) => sum + s.x!, 0) / list.length;
    const cy = list.reduce((sum, s) => sum + s.y!, 0) / list.length;
    const r = (deg * Math.PI) / 180;
    const ids = new Set(list.map((s) => s.id));
    change((all) =>
      all.map((s) => {
        if (!ids.has(s.id)) return s;
        const dx = s.x! - cx;
        const dy = s.y! - cy;
        const angle = normalizeAngle((s.angle ?? 0) + deg);
        lastAngle.current = angle;
        return { ...s, x: Math.round((cx + dx * Math.cos(r) - dy * Math.sin(r)) * 10) / 10, y: Math.round((cy + dx * Math.sin(r) + dy * Math.cos(r)) * 10) / 10, angle };
      }),
    );
  }

  // «Allinea in fila»: i posti scelti già sulla mappa si raddrizzano dove sono, in ordine di codice, stesso angolo e stesso passo
  // (una fila, o due una di fronte all'altra), come per i posti barca.
  function align() {
    const list = chosen.filter((s) => s.x !== null && s.y !== null);
    if (list.length < 2) return;
    const placements = alignRows(
      list.map((s) => ({ id: s.id, code: s.code, x: s.x!, y: s.y!, angle: s.angle ?? 0, lengthCm: s.lengthCm, beamCm: s.widthCm })),
      m,
    );
    const at = new Map(placements.map((p) => [p.id, p]));
    lastAngle.current = placements[0]?.angle ?? lastAngle.current;
    change((all) => all.map((s) => (at.has(s.id) ? { ...s, ...at.get(s.id)! } : s)), `${placements.length} posti auto allineati in fila. Se va bene, salva.`);
  }

  // Direzione della fila dei posti scelti (lungo la fila, che siano affiancati o uno dietro l'altro) e la sua lunghezza in metri.
  const placedChosen = chosen.filter((s) => s.x !== null && s.y !== null);
  const rowOf = (list: EditorParking[]) => {
    const axis = rowAxis(list.map((s) => ({ x: s.x!, y: s.y!, angle: s.angle ?? 0, lengthCm: s.lengthCm, beamCm: s.widthCm })), m);
    const proj = list.map((s) => s.x! * axis.d.x + s.y! * axis.d.y);
    const span = Math.max(...list.map((s) => (axis.mooring === "inglese" ? s.lengthCm : s.widthCm))) / 100;
    return { d: axis.d, lo: Math.min(...proj), hi: Math.max(...proj), lengthM: (Math.max(...proj) - Math.min(...proj)) / m + span };
  };
  const rowLengthM = placedChosen.length >= 2 ? rowOf(placedChosen).lengthM : null;

  // «Lunghezza ±1/±5 m»: allunga o accorcia la fila dal centro, lasciando i posti in fila e senza sovrapporli (stretchRows).
  function stretch(meters: number) {
    if (placedChosen.length < 2) return;
    const result = stretchRows(
      placedChosen.map((s) => ({ id: s.id, code: s.code, x: s.x!, y: s.y!, angle: s.angle ?? 0, lengthCm: s.lengthCm, beamCm: s.widthCm })),
      m,
      meters,
    );
    if (!result) return;
    const at = new Map(result.placements.map((p) => [p.id, p]));
    change((all) => all.map((s) => (at.has(s.id) ? { ...s, x: at.get(s.id)!.x, y: at.get(s.id)!.y } : s)));
  }


  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const layoutPayload = () =>
    spaces.map((s) => ({ id: s.id, position: s.x !== null && s.y !== null ? { x: s.x, y: s.y, angle: s.angle ?? 0 } : null }));

  // «Aggiungi un posto»: dopo l'ultimo (per codice) dei posti scelti, lungo la loro fila, alla distanza tipica tra un posto e l'altro.
  function addToRow() {
    if (placedChosen.length === 0) return;
    const list = byCode(placedChosen);
    const last = list[list.length - 1];
    let d: Point;
    let pitch: number;
    if (list.length === 1) {
      // Un posto solo: il nuovo gli va accanto, sul lato lungo.
      const a = ((last.angle ?? 0) * Math.PI) / 180;
      d = { x: Math.cos(a), y: Math.sin(a) };
      pitch = (last.widthCm / 100) * m * 1.05;
    } else {
      const axis = rowOf(list);
      d = axis.d;
      const first = list[0];
      if ((last.x! - first.x!) * d.x + (last.y! - first.y!) * d.y < 0) d = { x: -d.x, y: -d.y };
      const along = list.map((s) => s.x! * d.x + s.y! * d.y);
      const gaps = along.slice(1).map((t, i) => Math.abs(t - along[i])).sort((p, q) => p - q);
      pitch = gaps[Math.floor(gaps.length / 2)] || (last.widthCm / 100) * m * 1.05;
    }
    const position = { x: Math.round((last.x! + d.x * pitch) * 10) / 10, y: Math.round((last.y! + d.y * pitch) * 10) / 10, angle: last.angle ?? 0 };
    startSaving(async () => {
      const result = await addParkingToRow({ placements: layoutPayload(), afterId: last.id, position });
      setNotice(result);
      if (result.ok) {
        setDirty(false);
        carried = { notice: result, selected: [...selected, ...(result.id ? [result.id] : [])] };
      }
    });
  }

  // «Togli»: il posto scelto, oppure l'ultimo (per codice) della fila scelta; si elimina, se non è mai stato in un contratto.
  function removeFromRow() {
    const target = chosen.length === 1 ? chosen[0] : byCode(placedChosen).at(-1);
    if (!target || !window.confirm(`Eliminare il posto auto ${target.code}?`)) return;
    startSaving(async () => {
      const result = await removeParkingFromRow({ placements: layoutPayload(), id: target.id });
      setNotice(result);
      if (result.ok) {
        setDirty(false);
        carried = { notice: result, selected: [...selected].filter((id) => id !== target.id) };
      }
    });
  }

  function save() {
    startSaving(async () => {
      const result = await saveParkingLayout({
        placements: spaces.map((s) => ({ id: s.id, position: s.x !== null && s.y !== null ? { x: s.x, y: s.y, angle: s.angle ?? 0 } : null })),
      });
      setNotice(result);
      if (result.ok) setDirty(false);
    });
  }

  const hint =
    tool === "place"
      ? chosen.some((s) => s.x === null) || (chosen.length === 0 && unplaced.length > 0)
        ? `Clicca sulla mappa dove va il posto auto ${(chosen.find((s) => s.x === null) ?? unplaced[0])?.code ?? ""}: poi il successivo.`
        : "Non ci sono posti auto scelti da posare."
      : tool === "row"
        ? chosen.length === 0
          ? "Scegli prima i posti auto da mettere in fila (a destra)."
          : points.length === 0
            ? `Clicca dove inizia la fila (il posto ${chosen[0].code}).`
            : `Ora clicca dove finisce la fila (il posto ${chosen[chosen.length - 1].code}).`
        : "Tocca un posto auto per sceglierlo (Maiuscole o Ctrl per sceglierne altri) e trascinalo; trascina la mappa per muoverti, rotellina o due dita per ingrandire.";

  const toolButton = (value: Tool, label: string, Icon: typeof Plus, disabled = false) => (
    <button
      type="button"
      onClick={() => chooseTool(value)}
      disabled={disabled}
      aria-pressed={tool === value}
      className={`btn btn-sm ${tool === value ? "bg-ink text-white" : "btn-secondary"}`}
    >
      <Icon size={15} aria-hidden="true" /> {label}
    </button>
  );

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {toolButton("select", "Seleziona", MousePointer2)}
          {toolButton("place", "Posa sulla mappa", Plus, unplaced.length === 0)}
          {toolButton("row", "Metti in fila", Spline, chosen.length === 0)}
          <span className="inline-flex items-center gap-1 rounded-md border border-line bg-white p-0.5 text-sm" role="group" aria-label="Cosa c'è sotto">
            <span className="px-1.5 text-muted">Sotto:</span>
            {(["base", "foto"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={under === v}
                onClick={() => setUnder(v)}
                className={`rounded px-2 py-1 font-medium ${under === v ? "bg-ink text-white" : "text-ink hover:bg-line-soft"}`}
              >
                {v === "foto" ? "Foto dal vero" : map.baseUrl ? "Base disegnata" : "Schema"}
              </button>
            ))}
          </span>
        </div>
        <p className="mb-2 min-h-10 text-sm text-muted" aria-live="polite">
          {hint}
        </p>
        <PlanZoom width={map.width} height={map.height} arrowKeys={false} fillScreen>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${map.width} ${map.height}`}
            className="block h-auto w-full select-none"
            style={{ cursor: tool === "select" ? "default" : "crosshair" }}
            onClick={onCanvasClick}
          >
            {under === "foto" ? (
              <image href={imageUrl} width={map.width} height={map.height} preserveAspectRatio="none" />
            ) : map.baseUrl ? (
              <image href={map.baseUrl} width={map.width} height={map.height} preserveAspectRatio="none" />
            ) : (
              <g pointerEvents="none">
                <rect width={map.width} height={map.height} fill={WATER} />
                {map.features.map((f) =>
                  f.kind === "servizio" ? null : <path key={f.id} d={pathOf(f.points)} strokeLinejoin="round" strokeWidth={0.15 * m} {...SHAPE[f.kind]} />,
                )}
                {drawing?.piers.map((p) => (
                  <polygon key={p.id} points={p.outline.map((q) => `${q.x},${q.y}`).join(" ")} fill={PIER.fill} stroke={PIER.stroke} strokeWidth={0.12 * m} />
                ))}
              </g>
            )}
            {/* I posti barca in trasparenza, come riferimento. */}
            <g pointerEvents="none" opacity={0.35}>
              {map.berths.map((b) => {
                const { w, l } = berthSizePx(b, m);
                return (
                  <rect
                    key={b.id}
                    transform={`translate(${b.planX} ${b.planY}) rotate(${b.planAngle ?? 0})`}
                    x={-w / 2}
                    y={-l / 2}
                    width={w}
                    height={l}
                    fill="#24497a"
                    stroke="#fff"
                    strokeWidth={0.06 * m}
                  />
                );
              })}
            </g>
            {spaces.map((s) =>
              s.x === null || s.y === null ? null : (
                <g
                  key={s.id}
                  style={{ cursor: tool === "select" ? "move" : "inherit", touchAction: tool === "select" ? "none" : "auto" }}
                  onPointerDown={(e) => onSpaceDown(e, s)}
                  onPointerMove={onSpaceMove}
                  onPointerUp={() => (drag.current = null)}
                  onPointerCancel={() => (drag.current = null)}
                  onClick={(e) => tool === "select" && e.stopPropagation()}
                >
                  <ParkingMarks
                    pxPerMeter={m}
                    spaces={[
                      {
                        id: s.id,
                        code: s.code,
                        x: s.x,
                        y: s.y,
                        angle: s.angle ?? 0,
                        lengthCm: s.lengthCm,
                        widthCm: s.widthCm,
                        covered: s.covered,
                        state: !s.active ? "fermo" : selected.has(s.id) ? "occupato" : "libero",
                      },
                    ]}
                  />
                </g>
              ),
            )}
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={0.6 * m} fill="#d4502a" stroke="#fff" strokeWidth={0.15 * m} pointerEvents="none" />
            ))}
          </svg>
        </PlanZoom>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6">
        <section className="card space-y-3 p-4">
          <h3 className="text-[15px] font-semibold text-ink">
            Posti auto scelti <span className="font-normal text-muted">({chosen.length})</span>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set(spaces.map((s) => s.id)))}>
              Tutti
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={unplaced.length === 0} onClick={() => setSelected(new Set(unplaced.map((s) => s.id)))}>
              Da disporre ({unplaced.length})
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={chosen.length === 0} onClick={() => setSelected(new Set())}>
              Nessuno
            </button>
          </div>
          <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto" aria-label="Scegli i posti auto">
            {byCode(spaces).map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={selected.has(s.id)}
                onClick={() => toggle(s.id)}
                className={`rounded border px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                  selected.has(s.id) ? "border-[#4f5f6f] bg-[#4f5f6f] text-white" : "border-line bg-card text-ink"
                } ${s.x === null ? "border-dashed" : ""}`}
              >
                {s.code}
              </button>
            ))}
          </div>
          {chosen.length > 0 && (
            <div className="space-y-2 border-t border-line-soft pt-3">
              <p className="label">Ruota</p>
              <div className="flex gap-1">
                {[-90, -15, -1, 1, 15, 90].map((d) => (
                  <button key={d} type="button" className="btn btn-secondary btn-sm flex-1 px-1" onClick={() => rotate(d)}>
                    {d > 0 ? `+${d}°` : `${d}°`}
                  </button>
                ))}
              </div>
              <div>
                <p className="label">Posti della fila</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={saving || placedChosen.length === 0} onClick={addToRow}>
                    <Plus size={15} aria-hidden="true" /> Aggiungi un posto
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm text-bad" disabled={saving || placedChosen.length === 0} onClick={removeFromRow}>
                    <Minus size={15} aria-hidden="true" />{" "}
                    {chosen.length === 1 ? `Togli ${chosen[0].code}` : `Togli l'ultimo (${byCode(placedChosen).at(-1)?.code ?? ""})`}
                  </button>
                </div>
                <p className="hint mt-1">
                  Il posto nuovo prende il codice successivo, con tipo e misure dell&apos;ultimo, in fondo alla fila. Le posizioni che hai spostato si
                  salvano insieme.
                </p>
              </div>
              {rowLengthM !== null && (
                <div>
                  <p className="label">
                    Lunghezza: {rowLengthM.toLocaleString("it-IT", { maximumFractionDigits: 1 })} m
                  </p>
                  <div className="mt-1 flex gap-1">
                    {[-5, -1, 1, 5].map((d) => (
                      <button key={d} type="button" className="btn btn-secondary btn-sm flex-1 px-1" onClick={() => stretch(d)}>
                        {d > 0 ? `+${d} m` : `${d} m`}
                      </button>
                    ))}
                  </div>
                  <p className="hint mt-1">Allunga o accorcia la fila cambiando lo spazio tra i posti; le misure dei posti restano le stesse.</p>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={chosen.filter((s) => s.x !== null).length < 2}
                  onClick={align}
                >
                  Allinea in fila
                </button>
                {lastRow && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => layRow(lastRow.ids, lastRow.a, lastRow.b, !lastRow.flip)}>
                    <RotateCcw size={15} aria-hidden="true" /> Inverti il lato
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-bad"
                  onClick={() => change((all) => all.map((s) => (selected.has(s.id) ? { ...s, x: null, y: null, angle: null } : s)), "Posti auto tolti dalla mappa.")}
                >
                  Togli dalla mappa
                </button>
              </div>
            </div>
          )}
          <p className="hint">
            «Metti in fila»: scegli i posti auto, poi clicca inizio e fine della fila; si dispongono uno accanto all&apos;altro in ordine di codice,
            alla loro misura. «Allinea in fila» raddrizza i posti scelti dove sono: stessa linea, stesso angolo, stessa distanza. «Posa sulla
            mappa»: un clic per posto.
          </p>
        </section>

        <button type="button" className="btn btn-primary w-full" disabled={!dirty || saving} onClick={save}>
          {saving ? "Salvataggio…" : dirty ? "Salva i posti auto" : "Nessuna modifica da salvare"}
        </button>
        {notice && (
          <p role="status" className={`rounded-md px-3 py-2 text-sm ${notice.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
            {notice.message}
          </p>
        )}
      </aside>
    </div>
  );
}
