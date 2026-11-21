"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { Minus, MousePointer2, Plus, Ruler, Spline } from "lucide-react";
import { parseMeters } from "@/lib/format";
import { berthSizePx, distance, layoutPier, normalizeAngle, type Point } from "@/lib/plan";
import { savePlanLayout } from "@/server/plan-actions";

export interface EditorBerth {
  id: string;
  code: string;
  pierId: string;
  side: "sx" | "dx";
  position: number;
  lengthCm: number;
  beamCm: number;
  x: number | null;
  y: number | null;
  angle: number | null;
}

// select: sposta e ruota i posti · scale: due punti a distanza nota · pier: traccia un pontile · place: posa un posto
type Tool = "select" | "scale" | "pier" | "place";

const ZOOMS = [1, 1.5, 2, 3, 4];

export function PlanEditor({
  imageUrl,
  width,
  height,
  initialPxPerMeter,
  piers,
  initialBerths,
}: {
  imageUrl: string;
  width: number;
  height: number;
  initialPxPerMeter: number | null;
  piers: { id: string; name: string }[];
  initialBerths: EditorBerth[];
}) {
  const [berths, setBerths] = useState(initialBerths);
  const [pxPerMeter, setPxPerMeter] = useState(initialPxPerMeter);
  const [tool, setTool] = useState<Tool>(initialPxPerMeter ? "select" : "scale");
  const [points, setPoints] = useState<Point[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Si propone il primo pontile che ha dei posti.
  const [pierId, setPierId] = useState(piers.find((p) => initialBerths.some((b) => b.pierId === p.id))?.id ?? piers[0]?.id ?? "");
  const [pierWidth, setPierWidth] = useState("2,00");
  const [meters, setMeters] = useState("");
  const [zoom, setZoom] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const lastAngle = useRef(0);
  // Ultimo pontile tracciato: serve a rifarlo con i lati invertiti senza ricliccare sulla foto.
  const [lastTrace, setLastTrace] = useState<{ pierId: string; a: Point; b: Point; widthM: number; flip: boolean } | null>(null);
  // Linee tracciate in questa sessione, una per pontile: si salvano per disegnare i pontili nello schema.
  const [traces, setTraces] = useState<Record<string, { a: Point; b: Point; widthM: number }>>({});

  // Unità di disegno: spessori e testi restano proporzionati qualunque sia la dimensione della foto.
  const u = width / 1000;
  const selected = berths.find((b) => b.id === selectedId) ?? null;
  const unplaced = berths.filter((b) => b.x === null);
  const placedCount = berths.length - unplaced.length;
  const sizeOf = (b: EditorBerth) => (pxPerMeter ? berthSizePx(b, pxPerMeter) : { w: 14 * u, l: 36 * u });
  const pierBerths = berths.filter((b) => b.pierId === pierId);
  const hasBerths = berths.length > 0;

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
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  }

  function update(id: string, patch: Partial<EditorBerth>) {
    setBerths((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setDirty(true);
    setNotice(null);
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
      update(selectedId, { x: p.x, y: p.y, angle: lastAngle.current });
      setTool("select");
    } else if (tool === "pier") {
      if (points.length === 0) {
        setPoints([p]);
        return;
      }
      const width = parseMeters(pierWidth);
      tracePier({ pierId, a: points[0], b: p, widthM: (width ?? 200) / 100, flip: false });
      setPoints([]);
    }
  }

  // Dispone i posti di un pontile lungo la linea a → b.
  function tracePier(trace: { pierId: string; a: Point; b: Point; widthM: number; flip: boolean }) {
    const placements = pxPerMeter
      ? layoutPier(
          berths.filter((b) => b.pierId === trace.pierId),
          trace.a,
          trace.b,
          pxPerMeter,
          trace.widthM,
          trace.flip,
        )
      : [];
    if (placements.length === 0) {
      setNotice({ ok: false, message: "Questo pontile non ha posti da disporre: creali prima in «Pontili e posti»." });
      return;
    }
    const byId = new Map(placements.map((pl) => [pl.id, pl]));
    setBerths((list) => list.map((b) => (byId.has(b.id) ? { ...b, ...byId.get(b.id)! } : b)));
    lastAngle.current = placements[0].angle;
    setLastTrace(trace);
    setTraces((all) => ({ ...all, [trace.pierId]: { a: trace.a, b: trace.b, widthM: trace.widthM } }));
    setDirty(true);
    setNotice({
      ok: true,
      message: trace.flip
        ? `Lati invertiti: ${placements.length} posti spostati dall'altra parte della linea.`
        : `${placements.length} posti disposti. Se sono dalla parte sbagliata premi «Inverti i lati»; i singoli posti si ritoccano con «Seleziona».`,
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
    setNotice({ ok: true, message: "Scala impostata: ora i posti compaiono nelle loro dimensioni reali." });
  }

  // Trascinamento di un posto (solo con lo strumento «Seleziona»).
  function onBerthDown(e: PointerEvent<SVGGElement>, b: EditorBerth) {
    if (tool !== "select" || b.x === null || b.y === null) return;
    e.stopPropagation();
    setSelectedId(b.id);
    const p = toImage(e);
    drag.current = { id: b.id, dx: p.x - b.x, dy: p.y - b.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onBerthMove(e: PointerEvent<SVGGElement>) {
    const d = drag.current;
    if (!d) return;
    const p = toImage(e);
    update(d.id, { x: clamp(p.x - d.dx, 0, width), y: clamp(p.y - d.dy, 0, height) });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!selected || selected.x === null || selected.y === null) return;
    const step = (e.shiftKey ? 10 : 1) * u;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    update(selected.id, { x: clamp(selected.x + move[0], 0, width), y: clamp(selected.y + move[1], 0, height) });
  }

  function rotate(delta: number) {
    if (!selected) return;
    const angle = normalizeAngle((selected.angle ?? 0) + delta);
    lastAngle.current = angle;
    update(selected.id, { angle });
  }

  function save() {
    startSaving(async () => {
      const result = await savePlanLayout({
        pxPerMeter,
        placements: berths.map((b) => ({ id: b.id, position: b.x !== null && b.y !== null ? { x: b.x, y: b.y, angle: b.angle ?? 0 } : null })),
        traces: Object.entries(traces).map(([pierId, t]) => ({ pierId, ...t })),
      });
      setNotice(result);
      if (result.ok) {
        setDirty(false);
        setTraces({});
      }
    });
  }

  const toolButton = (value: Tool, label: string, Icon: typeof Ruler, disabled = false) => (
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
      : tool === "pier"
        ? !pxPerMeter
          ? "Imposta prima la scala."
          : points.length === 0
            ? "Clicca la radice del pontile scelto (dove si attacca alla banchina)."
            : "Ora clicca la testata del pontile: i suoi posti verranno disposti lungo la linea."
        : tool === "place"
          ? `Clicca sulla foto il punto in cui si trova il posto ${selected?.code ?? ""}.`
          : "Trascina un posto per spostarlo; con le frecce della tastiera lo sposti di poco.";

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {toolButton("select", "Seleziona", MousePointer2)}
          {toolButton("scale", "Imposta scala", Ruler)}
          {toolButton("pier", "Disponi un pontile", Spline, !pxPerMeter || pierBerths.length === 0)}
          <span className="ml-auto flex items-center gap-1">
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Riduci" disabled={zoom === ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}>
              <Minus size={15} aria-hidden="true" />
            </button>
            <span className="w-12 text-center text-sm text-muted tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Ingrandisci" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}>
              <Plus size={15} aria-hidden="true" />
            </button>
          </span>
        </div>
        <p className="mb-2 min-h-10 text-sm text-muted" aria-live="polite">
          {hint}
        </p>

        <div className="max-h-[78vh] overflow-auto rounded-lg border border-line bg-deep/5 focus-visible:outline-2" tabIndex={0} onKeyDown={onKeyDown} aria-label="Editor della pianta">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: `${zoom * 100}%`, cursor: tool === "select" ? "default" : "crosshair" }}
            className="block h-auto max-w-none select-none"
            onClick={onCanvasClick}
          >
            <image href={imageUrl} width={width} height={height} />
            {berths.map((b) => {
              if (b.x === null || b.y === null) return null;
              const { w, l } = sizeOf(b);
              const active = b.id === selectedId;
              return (
                <g
                  key={b.id}
                  transform={`translate(${b.x} ${b.y})`}
                  style={{ cursor: tool === "select" ? "move" : "inherit", touchAction: tool === "select" ? "none" : "auto" }}
                  onPointerDown={(e) => onBerthDown(e, b)}
                  onPointerMove={onBerthMove}
                  onPointerUp={() => (drag.current = null)}
                  onPointerCancel={() => (drag.current = null)}
                  onClick={(e) => tool === "select" && e.stopPropagation()}
                >
                  <rect
                    transform={`rotate(${b.angle ?? 0})`}
                    x={-w / 2}
                    y={-l / 2}
                    width={w}
                    height={l}
                    rx={u}
                    fill={active ? "#d4502a" : "#0f6480"}
                    fillOpacity={active ? 0.75 : 0.6}
                    stroke="#fff"
                    strokeWidth={(active ? 2.4 : 1.2) * u}
                  />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={clamp(w * 0.42, 7 * u, 15 * u)} fontWeight={600} fill="#fff" pointerEvents="none">
                    {b.code}
                  </text>
                </g>
              );
            })}
            {points.length === 2 && <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} stroke="#d4502a" strokeWidth={2 * u} strokeDasharray={`${6 * u} ${4 * u}`} pointerEvents="none" />}
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={5 * u} fill="#d4502a" stroke="#fff" strokeWidth={1.5 * u} pointerEvents="none" />
            ))}
          </svg>
        </div>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6">
        <section className="card p-4">
          <h3 className="text-[15px] font-semibold text-ink">Scala</h3>
          <p className="mt-1 text-sm text-muted">{pxPerMeter ? `1 metro = ${pxPerMeter.toLocaleString("it-IT", { maximumFractionDigits: 2 })} pixel della foto.` : "Non ancora impostata: serve per disegnare i posti nelle misure reali."}</p>
          {tool === "scale" && points.length === 2 && (
            <div className="mt-3 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor="plan-meters" className="label">
                  Distanza reale (m)
                </label>
                <input id="plan-meters" className="input" inputMode="decimal" placeholder="Es. 42,50" value={meters} onChange={(e) => setMeters(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyScale()} />
              </div>
              <button type="button" className="btn btn-primary" disabled={!parseMeters(meters)} onClick={applyScale}>
                Applica
              </button>
            </div>
          )}
        </section>

        <section className="card p-4">
          <h3 className="text-[15px] font-semibold text-ink">Disponi un pontile</h3>
          <p className="mt-1 text-sm text-muted">Scegli il pontile, poi tracciane l&apos;asse sulla foto con due clic: dalla radice alla testata.</p>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="plan-pier" className="label">
                Pontile (posti già disposti)
              </label>
              <select id="plan-pier" className="input" value={pierId} onChange={(e) => setPierId(e.target.value)}>
                {piers.map((p) => {
                  const list = berths.filter((b) => b.pierId === p.id);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} ({list.filter((b) => b.x !== null).length} di {list.length})
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label htmlFor="plan-pier-width" className="label">
                Larghezza del pontile (m)
              </label>
              <input id="plan-pier-width" className="input" inputMode="decimal" value={pierWidth} onChange={(e) => setPierWidth(e.target.value)} />
            </div>
            <button type="button" className="btn btn-secondary w-full" disabled={!pxPerMeter || pierBerths.length === 0} onClick={() => chooseTool("pier")}>
              Traccia il pontile sulla foto
            </button>
            {!pxPerMeter && hasBerths && <p className="hint">Prima imposta la scala.</p>}
            {pxPerMeter && pierId && pierBerths.length === 0 && hasBerths && <p className="hint">Questo pontile non ha ancora posti.</p>}
            {lastTrace && lastTrace.pierId === pierId && (
              <button type="button" className="btn btn-ghost w-full" onClick={() => tracePier({ ...lastTrace, flip: !lastTrace.flip })}>
                Inverti i lati
              </button>
            )}
            <p className="hint">Per una banchina, traccia la linea lungo il bordo del molo e metti larghezza 0.</p>
          </div>
        </section>

        {selected && (
          <section className="card p-4">
            <h3 className="text-[15px] font-semibold text-ink">Posto {selected.code}</h3>
            {selected.x === null ? (
              <p className="mt-1 text-sm text-muted">Clicca sulla foto per posarlo.</p>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
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
                      update(selected.id, { angle: Number(e.target.value) });
                    }}
                    className="w-full accent-sea"
                  />
                  <div className="mt-1 flex gap-1">
                    {[-90, -5, -1, 1, 5, 90].map((d) => (
                      <button key={d} type="button" className="btn btn-secondary btn-sm flex-1 px-1" onClick={() => rotate(d)}>
                        {d > 0 ? `+${d}°` : `${d}°`}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => update(selected.id, { x: null, y: null, angle: null })}>
                  Togli dalla pianta
                </button>
              </div>
            )}
          </section>
        )}

        <section className="card p-4">
          <h3 className="text-[15px] font-semibold text-ink">
            Da disporre <span className="font-normal text-muted">({unplaced.length})</span>
          </h3>
          {!hasBerths ? (
            <p className="mt-1 text-sm text-muted">
              Non ci sono ancora posti barca. Intanto puoi impostare la scala; poi crea pontili e posti in{" "}
              <a href="/impostazioni/pontili" className="link">
                Pontili e posti
              </a>{" "}
              e torna qui per disporli.
            </p>
          ) : unplaced.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Tutti i {berths.length} posti sono sulla pianta.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">Tocca un posto e poi il punto della foto in cui si trova.</p>
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
          <button type="button" className="btn btn-primary w-full" disabled={saving || !dirty} onClick={save}>
            {saving ? "Salvataggio…" : dirty ? "Salva la pianta" : "Nessuna modifica da salvare"}
          </button>
          <p className="text-center text-xs text-muted">
            {placedCount} di {berths.length} posti disposti
          </p>
          {notice && (
            <p role={notice.ok ? "status" : "alert"} className={`rounded-md px-3 py-2 text-sm ${notice.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
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
