"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  Building2,
  Check,
  Eraser,
  Image as ImageIcon,
  MapPin,
  MousePointer2,
  Sparkles,
  Trash2,
  Trees,
  Undo2,
  Wand2,
  X,
  type AppIcon,
} from "@/components/icons";
import { PlanZoom } from "@/app/(app)/mappa/plan-zoom";
import { ServiceIcon, ServiceMarker } from "@/components/service-icon";
import { landContours, landMask } from "@/lib/land-mask";
import type { Point } from "@/lib/plan";
import {
  drawingOrder,
  FEATURE_LABEL,
  pathOf,
  type PlanFeature,
} from "@/lib/plan-features";
import { SHAPE, WATER } from "@/lib/plan-style";
import { PORT_SERVICES, serviceLabel, serviceTitle } from "@/lib/port-services";
import { analyzeSurroundings, savePlanFeatures } from "@/server/plan-actions";

// select: scegli e sposta · terra / acqua / edificio / verde: disegna una forma con i clic · servizio: posa un servizio
type Tool = "select" | "terra" | "acqua" | "edificio" | "verde" | "servizio";

export interface BerthRect {
  x: number;
  y: number;
  angle: number;
  w: number;
  l: number;
}

// Sensibilità del riconoscimento dai colori: quanto un colore può scostarsi da quello dell'acqua.
const TOLERANCE = { bassa: 38, media: 52, alta: 70 } as const;

let counter = 0;
const newId = () => `nuovo-${Date.now().toString(36)}-${counter++}`;

export function SurroundingsEditor({
  imageUrl,
  width,
  height,
  pxPerMeter,
  initialFeatures,
  berthRects,
  waterSeeds,
  aiAvailable,
  baseUrl,
}: {
  imageUrl: string;
  width: number;
  height: number;
  pxPerMeter: number | null;
  initialFeatures: PlanFeature[];
  berthRects: BerthRect[];
  waterSeeds: Point[];
  aiAvailable: boolean;
  // Base disegnata caricata: lo schema usa quella, e qui restano da sistemare solo i servizi.
  baseUrl: string | null;
}) {
  const [features, setFeatures] = useState(initialFeatures);
  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState<Point[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [serviceType, setServiceType] = useState<string>(PORT_SERVICES[0].key);
  const [under, setUnder] = useState<"base" | "foto" | "niente">(
    baseUrl ? "base" : "foto",
  );
  const showPhoto = under === "foto";
  const showShapes = !baseUrl;
  const [sensitivity, setSensitivity] =
    useState<keyof typeof TOLERANCE>("media");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<"colori" | "claude" | null>(null);
  const [saving, startSaving] = useTransition();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    id: string;
    index: number;
    dx: number;
    dy: number;
  } | null>(null);

  // Unità di disegno proporzionata alla foto; con la scala si usano anche i metri.
  const u = Math.max(width, height) / 1000;
  const marker = pxPerMeter
    ? Math.min(Math.max(11 * u, 1.5 * pxPerMeter), 8 * pxPerMeter)
    : 11 * u;
  const ordered = useMemo(() => drawingOrder(features), [features]);
  const selected = features.find((f) => f.id === selectedId) ?? null;
  const services = features.filter((f) => f.kind === "servizio");
  const counts = {
    forme: features.length - services.length,
    servizi: services.length,
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(next: PlanFeature[], message?: string) {
    setFeatures(next);
    setDirty(true);
    setNotice(message ? { ok: true, message } : null);
  }

  function toImage(e: { clientX: number; clientY: number }): Point {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  }

  function chooseTool(next: Tool) {
    setTool(next);
    setDraft([]);
    if (next !== "select") setSelectedId(null);
  }

  function closeDraft() {
    if (tool === "select" || tool === "servizio" || draft.length < 3) return;
    const feature: PlanFeature = {
      id: newId(),
      kind: tool,
      service: null,
      name: null,
      points: draft,
      source: "manuale",
    };
    change([...features, feature]);
    setDraft([]);
    setSelectedId(feature.id);
  }

  function onCanvasClick(e: React.MouseEvent<SVGSVGElement>) {
    const p = toImage(e);
    if (tool === "select") {
      setSelectedId(null);
    } else if (tool === "servizio") {
      const feature: PlanFeature = {
        id: newId(),
        kind: "servizio",
        service: serviceType,
        name: null,
        points: [p],
        source: "manuale",
      };
      change([...features, feature]);
      setSelectedId(feature.id);
      setTool("select");
    } else {
      // Un clic vicino al primo punto chiude la forma.
      const first = draft[0];
      if (
        first &&
        draft.length >= 3 &&
        Math.hypot(p.x - first.x, p.y - first.y) < 8 * u
      )
        closeDraft();
      else setDraft((d) => [...d, p]);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (draft.length > 0) {
      if (e.key === "Enter") closeDraft();
      else if (e.key === "Escape") setDraft([]);
      else if (e.key === "Backspace") setDraft((d) => d.slice(0, -1));
      else return;
      e.preventDefault();
    } else if (selected && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      remove(selected.id);
    }
  }

  function update(id: string, patch: Partial<PlanFeature>) {
    change(features.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function remove(id: string) {
    change(
      features.filter((f) => f.id !== id),
      "Elemento tolto: ricordati di salvare.",
    );
    setSelectedId(null);
  }

  // Trascinamento di un servizio o di un vertice della forma scelta (solo con «Seleziona»).
  function onHandleDown(
    e: PointerEvent<SVGElement>,
    id: string,
    index: number,
  ) {
    if (tool !== "select") return;
    e.stopPropagation();
    setSelectedId(id);
    const f = features.find((x) => x.id === id);
    if (!f) return;
    const p = toImage(e);
    drag.current = {
      id,
      index,
      dx: p.x - f.points[index].x,
      dy: p.y - f.points[index].y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onHandleMove(e: PointerEvent<SVGElement>) {
    const d = drag.current;
    if (!d) return;
    const p = toImage(e);
    setFeatures((list) =>
      list.map((f) =>
        f.id === d.id
          ? {
              ...f,
              points: f.points.map((q, i) =>
                i === d.index ? { x: p.x - d.dx, y: p.y - d.dy } : q,
              ),
            }
          : f,
      ),
    );
    setDirty(true);
  }

  // Terra e acqua dai colori della foto, nel browser: la foto si riduce, si confrontano i colori con quelli dell'acqua
  // vicino ai posti barca e se ne ricavano i contorni.
  async function deriveFromColors() {
    if (waterSeeds.length === 0) return;
    setBusy("colori");
    setNotice(null);
    try {
      const img = new Image();
      img.src = imageUrl;
      await img.decode();
      const scale = Math.min(1, 700 / Math.max(width, height));
      const gw = Math.max(1, Math.round(width * scale));
      const gh = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = gw;
      canvas.height = gh;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("canvas");
      ctx.drawImage(img, 0, 0, gw, gh);
      const { data } = ctx.getImageData(0, 0, gw, gh);

      // I posti barca (con le barche sopra) contano come acqua.
      const forced = new Uint8Array(gw * gh);
      for (const r of berthRects) {
        const a = (r.angle * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const reach = Math.hypot(r.w, r.l) / 2;
        const x0 = Math.max(0, Math.floor((r.x - reach) * scale));
        const x1 = Math.min(gw - 1, Math.ceil((r.x + reach) * scale));
        const y0 = Math.max(0, Math.floor((r.y - reach) * scale));
        const y1 = Math.min(gh - 1, Math.ceil((r.y + reach) * scale));
        for (let gy = y0; gy <= y1; gy++) {
          for (let gx = x0; gx <= x1; gx++) {
            const dx = (gx + 0.5) / scale - r.x;
            const dy = (gy + 0.5) / scale - r.y;
            // Nel sistema del posto: lungo la larghezza (lx) e lungo la lunghezza (ly).
            const lx = dx * cos + dy * sin;
            const ly = -dx * sin + dy * cos;
            if (Math.abs(lx) <= r.w / 2 && Math.abs(ly) <= r.l / 2)
              forced[gy * gw + gx] = 1;
          }
        }
      }

      const cellM2 = pxPerMeter ? (1 / scale / pxPerMeter) ** 2 : null;
      const cells = (m2: number, fallback: number) =>
        cellM2 ? Math.max(2, Math.round(m2 / cellM2)) : fallback;
      const mask = landMask(data, gw, gh, {
        seeds: waterSeeds.map((p) => ({ x: p.x * scale, y: p.y * scale })),
        forcedWater: forced,
        tolerance: TOLERANCE[sensitivity],
        minLandCells: cells(150, 30),
        minHoleCells: cells(60, 12),
        closeCells: pxPerMeter
          ? Math.max(1, Math.round((1.5 * pxPerMeter * scale) / 1))
          : 2,
      });
      const rings = landContours(mask, gw, gh, 0.9, cells(40, 6));
      const derived: PlanFeature[] = rings.map((r) => ({
        id: newId(),
        kind: r.land ? "terra" : "acqua",
        service: null,
        name: null,
        points: r.points.map((p) => ({
          x: Math.round((p.x / scale) * 10) / 10,
          y: Math.round((p.y / scale) * 10) / 10,
        })),
        source: "colori",
      }));
      if (derived.length === 0) {
        setNotice({
          ok: false,
          message:
            "Dai colori della foto non si distingue la terra dall'acqua: prova con una sensibilità diversa o disegnala a mano.",
        });
        return;
      }
      // Le forme ricavate prima dai colori si sostituiscono; quelle disegnate a mano restano (e vengono dopo, così le correggono).
      change(
        [...derived, ...features.filter((f) => f.source !== "colori")],
        `${derived.length === 1 ? "Ricavata 1 forma" : `Ricavate ${derived.length} forme`} di terra e acqua. Controlla, correggi con «Terra» e «Togli terra», poi salva.`,
      );
      setSelectedId(null);
    } catch {
      setNotice({
        ok: false,
        message:
          "Non è stato possibile leggere la foto. Ricarica la pagina e riprova.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function askClaude() {
    setBusy("claude");
    setNotice(null);
    try {
      const result = await analyzeSurroundings();
      if (result.ok && result.features) {
        // Con la base disegnata servono solo i servizi: edifici e verde sono già nella base.
        const proposed = result.features
          .filter((f) => showShapes || f.kind === "servizio")
          .map((f) => ({ ...f, id: newId() }));
        change([...features.filter((f) => f.source !== "claude"), ...proposed]);
      }
      setNotice({ ok: result.ok, message: result.message });
    } catch {
      setNotice({
        ok: false,
        message: "La richiesta non è riuscita. Riprova tra poco.",
      });
    } finally {
      setBusy(null);
    }
  }

  function clearAll() {
    if (
      !window.confirm(
        "Togliere tutto lo sfondo e i servizi? Diventa definitivo solo quando salvi.",
      )
    )
      return;
    change([], "Sfondo svuotato: salva per confermare.");
    setSelectedId(null);
  }

  function save() {
    startSaving(async () => {
      const result = await savePlanFeatures(
        features.map((f) => ({
          kind: f.kind,
          service: f.service,
          name: f.name,
          points: f.points,
          source: f.source,
        })),
      );
      setNotice(result);
      if (result.ok) setDirty(false);
    });
  }

  const allTools: [Tool, string, AppIcon][] = [
    ["select", "Seleziona", MousePointer2],
    ["terra", "Terra", Wand2],
    ["acqua", "Togli terra", Eraser],
    ["edificio", "Edificio", Building2],
    ["verde", "Verde", Trees],
    ["servizio", "Servizio", MapPin],
  ];
  const tools = showShapes
    ? allTools
    : allTools.filter(([t]) => t === "select" || t === "servizio");
  const drawing = tool !== "select" && tool !== "servizio";
  const opacity = showPhoto ? 0.72 : 1;

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {showShapes && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={deriveFromColors}
                disabled={busy !== null || waterSeeds.length === 0}
              >
                <Wand2 size={15} aria-hidden="true" />
                {busy === "colori"
                  ? "Analisi dei colori…"
                  : "Terra e acqua dai colori della foto"}
              </button>
              <label className="inline-flex items-center gap-1.5 text-sm text-muted">
                Sensibilità
                <select
                  className="input w-auto py-1 text-sm"
                  value={sensitivity}
                  onChange={(e) =>
                    setSensitivity(e.target.value as keyof typeof TOLERANCE)
                  }
                >
                  <option value="bassa">bassa</option>
                  <option value="media">media</option>
                  <option value="alta">alta</option>
                </select>
              </label>
            </>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={askClaude}
            disabled={busy !== null || !aiAvailable}
            title={
              aiAvailable ? undefined : "Riconoscimento automatico non attivo"
            }
          >
            <Sparkles size={15} aria-hidden="true" />
            {busy === "claude"
              ? "Claude sta guardando la foto…"
              : showShapes
                ? "Edifici e servizi con Claude"
                : "Servizi con Claude"}
          </button>
        </div>
        {!showShapes && (
          <p className="text-sm text-muted">
            C&apos;è la base disegnata: terra, moli ed edifici sono già lì. Qui
            sistemi solo i servizi, che la direzione può spostare quando vuole.
          </p>
        )}
        {showShapes && waterSeeds.length === 0 && (
          <p className="text-xs text-muted">
            Per ricavare terra e acqua dai colori servono i posti barca già
            disposti sulla foto.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {tools.map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => chooseTool(value)}
              aria-pressed={tool === value}
              className={`btn btn-sm ${tool === value ? "bg-ink text-white" : "btn-secondary"}`}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1.5 text-sm text-muted">
            <ImageIcon size={15} aria-hidden="true" /> Sotto
            <select
              className="input w-auto py-1 text-sm"
              value={under}
              onChange={(e) => setUnder(e.target.value as typeof under)}
            >
              {baseUrl && <option value="base">base disegnata</option>}
              <option value="foto">foto aerea</option>
              <option value="niente">niente</option>
            </select>
          </label>
        </div>

        {tool === "servizio" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-sea-soft px-3 py-2 text-sm text-sea-dark">
            <select
              className="input w-auto py-1 text-sm"
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              aria-label="Tipo di servizio"
            >
              {PORT_SERVICES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <span>poi tocca la foto dove si trova.</span>
          </div>
        )}
        {drawing && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-sea-soft px-3 py-2 text-sm text-sea-dark">
            <span>
              {tool === "acqua"
                ? "Contorna la zona da riportare ad acqua"
                : `Contorna ${tool === "terra" ? "la terra (molo, banchina, piazzale)" : tool === "edificio" ? "l'edificio" : "l'area verde"}`}{" "}
              con un clic per vertice; chiudi toccando il primo punto o con
              «Chiudi».
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={closeDraft}
              disabled={draft.length < 3}
            >
              <Check size={15} aria-hidden="true" /> Chiudi
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDraft((d) => d.slice(0, -1))}
              disabled={draft.length === 0}
            >
              <Undo2 size={15} aria-hidden="true" /> Togli l&apos;ultimo punto
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDraft([])}
              disabled={draft.length === 0}
            >
              <X size={15} aria-hidden="true" /> Annulla
            </button>
          </div>
        )}

        <div tabIndex={-1} onKeyDown={onKeyDown} className="outline-none">
          <PlanZoom width={width} height={height}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${width} ${height}`}
              className="block h-auto w-full select-none"
              style={{ cursor: tool === "select" ? undefined : "crosshair" }}
              onClick={onCanvasClick}
              aria-label="Sfondo della mappa"
            >
              <rect width={width} height={height} fill={WATER} />
              {showPhoto && (
                <image href={imageUrl} width={width} height={height} />
              )}
              {under === "base" && baseUrl && (
                <image
                  href={baseUrl}
                  width={width}
                  height={height}
                  preserveAspectRatio="none"
                />
              )}
              {ordered.map((f) =>
                f.kind === "servizio" || !showShapes ? null : (
                  <path
                    key={f.id}
                    d={pathOf(f.points)}
                    fill={SHAPE[f.kind].fill}
                    fillOpacity={
                      f.kind === "acqua" && showPhoto ? 0.55 : opacity
                    }
                    stroke={
                      f.id === selectedId
                        ? "#d4502a"
                        : SHAPE[f.kind].stroke === "none"
                          ? "#7fb1c7"
                          : SHAPE[f.kind].stroke
                    }
                    strokeWidth={(f.id === selectedId ? 2.5 : 1) * u}
                    strokeDasharray={
                      f.kind === "acqua" ? `${4 * u} ${3 * u}` : undefined
                    }
                    strokeLinejoin="round"
                    onClick={(e) => {
                      if (tool !== "select") return;
                      e.stopPropagation();
                      setSelectedId(f.id);
                    }}
                    style={{
                      cursor: tool === "select" ? "pointer" : undefined,
                    }}
                  />
                ),
              )}
              {selected &&
                selected.kind !== "servizio" &&
                showShapes &&
                selected.points.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={3.5 * u}
                    fill="#ffffff"
                    stroke="#d4502a"
                    strokeWidth={1.2 * u}
                    style={{ cursor: "grab", touchAction: "none" }}
                    onPointerDown={(e) => onHandleDown(e, selected.id, i)}
                    onPointerMove={onHandleMove}
                    onPointerUp={() => (drag.current = null)}
                    onPointerCancel={() => (drag.current = null)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ))}
              {services.map((f) => (
                <g
                  key={f.id}
                  style={{
                    cursor: tool === "select" ? "grab" : undefined,
                    touchAction: "none",
                  }}
                  onPointerDown={(e) => onHandleDown(e, f.id, 0)}
                  onPointerMove={onHandleMove}
                  onPointerUp={() => (drag.current = null)}
                  onPointerCancel={() => (drag.current = null)}
                  onClick={(e) => {
                    if (tool !== "select") return;
                    e.stopPropagation();
                    setSelectedId(f.id);
                  }}
                >
                  <title>{serviceTitle(f.service ?? "", f.name)}</title>
                  <ServiceMarker
                    service={f.service ?? ""}
                    x={f.points[0].x}
                    y={f.points[0].y}
                    r={marker}
                    selected={f.id === selectedId}
                  />
                </g>
              ))}
              {draft.length > 0 && (
                <g pointerEvents="none">
                  <polyline
                    points={draft.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="#d4502a"
                    strokeWidth={2 * u}
                    strokeDasharray={`${5 * u} ${3 * u}`}
                  />
                  {draft.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={(i === 0 ? 5 : 3.5) * u}
                      fill={i === 0 ? "#d4502a" : "#ffffff"}
                      stroke="#d4502a"
                      strokeWidth={1.2 * u}
                    />
                  ))}
                </g>
              )}
            </svg>
          </PlanZoom>
        </div>
      </div>

      <aside className="space-y-3">
        {selected ? (
          <div className="card space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-ink">
                {selected.kind === "servizio"
                  ? serviceLabel(selected.service ?? "")
                  : FEATURE_LABEL[selected.kind]}
                {selected.source !== "manuale" && (
                  <span className="ml-1.5 text-xs font-normal text-muted">
                    (
                    {selected.source === "colori"
                      ? "dai colori"
                      : "proposto da Claude"}
                    )
                  </span>
                )}
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-bad"
                onClick={() => remove(selected.id)}
              >
                <Trash2 size={15} aria-hidden="true" /> Elimina
              </button>
            </div>
            {selected.kind === "servizio" && (
              <label className="block text-sm">
                <span className="text-muted">Tipo</span>
                <select
                  className="input mt-1"
                  value={selected.service ?? ""}
                  onChange={(e) =>
                    update(selected.id, { service: e.target.value })
                  }
                >
                  {PORT_SERVICES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(selected.kind === "servizio" || selected.kind === "edificio") && (
              <label className="block text-sm">
                <span className="text-muted">Nome (facoltativo)</span>
                <input
                  className="input mt-1"
                  value={selected.name ?? ""}
                  maxLength={80}
                  placeholder={
                    selected.kind === "servizio"
                      ? "es. Bar La Vela"
                      : "es. Capitaneria"
                  }
                  onChange={(e) =>
                    update(selected.id, { name: e.target.value || null })
                  }
                />
              </label>
            )}
            {selected.kind !== "servizio" && (
              <p className="text-xs text-muted">
                Trascina i pallini per spostare i vertici.
              </p>
            )}
            {selected.kind === "servizio" && (
              <p className="text-xs text-muted">
                Trascina il segnaposto per spostarlo.
              </p>
            )}
          </div>
        ) : (
          <div className="card p-4 text-sm text-muted">
            {showShapes
              ? "Con «Seleziona» tocca una forma o un servizio per modificarlo o eliminarlo. Le forme «Togli terra» riportano ad acqua una zona sbagliata."
              : "Con «Seleziona» tocca un servizio per cambiarne tipo e nome, trascinalo per spostarlo. Con «Servizio» ne aggiungi uno nuovo."}
          </div>
        )}

        {services.length > 0 && (
          <div className="card p-4">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">
              Servizi sulla mappa
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {services.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 text-left text-ink hover:underline"
                    onClick={() => {
                      setTool("select");
                      setSelectedId(f.id);
                    }}
                  >
                    <span
                      className="grid size-6 shrink-0 place-items-center rounded-full bg-[#1d3f63] text-white"
                      aria-hidden="true"
                    >
                      <ServiceIcon service={f.service ?? ""} size={13} />
                    </span>
                    {serviceTitle(f.service ?? "", f.name)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {notice && (
          <p
            className={`rounded-md px-3 py-2 text-sm ${notice.ok ? "bg-ok-soft text-ok" : "bg-bad/10 text-bad"}`}
          >
            {notice.message}
          </p>
        )}

        <div className="space-y-2">
          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={save}
            disabled={saving || !dirty}
          >
            {saving
              ? "Salvataggio…"
              : dirty
                ? showShapes
                  ? "Salva lo sfondo"
                  : "Salva i servizi"
                : "Nessuna modifica da salvare"}
          </button>
          <p className="text-xs text-muted">
            {showShapes
              ? `${counts.forme} forme e ${counts.servizi} servizi.`
              : `${counts.servizi} servizi.`}
          </p>
          {features.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm w-full text-bad"
              onClick={clearAll}
            >
              Togli tutto lo sfondo
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
