"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type PointerEvent } from "react";
import { ArrowLeftRight, LoaderCircle, Plus, ScanSearch, X } from "lucide-react";
import { PlanZoom } from "@/app/(app)/mappa/plan-zoom";
import { berthSizePx, type Point } from "@/lib/plan";
import { categoryForLength, MAX_BERTHS_PER_SIDE, planBerths, suggestCodes, type Side, type StoredAnalysis, type StructureKind } from "@/lib/plan-analysis";
import { analyzePlan, createFromProposals, discardPlanAnalysis } from "@/server/plan-actions";

export interface DetectCategory {
  id: string;
  name: string;
  maxLengthCm: number;
  maxBeamCm: number;
}

interface ItemSide {
  side: Side;
  count: number;
  categoryId: string;
}

interface Item {
  key: number;
  include: boolean;
  code: string;
  name: string;
  kind: StructureKind;
  a: Point;
  b: Point;
  sides: ItemSide[];
}

const SIDE_LABEL: Record<Side, string> = { sx: "Lato sinistro", dx: "Lato destro" };
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Riquadro «Riconoscimento automatico»: lancia l'analisi della foto oppure mostra le proposte da confermare. */
export function AutoDetect(props: {
  available: boolean;
  analysis: StoredAnalysis | null;
  imageUrl: string;
  width: number;
  height: number;
  pxPerMeter: number | null;
  categories: DetectCategory[];
  usedCodes: string[];
  placed: { x: number; y: number; angle: number; lengthCm: number; beamCm: number }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function run() {
    setResult(null);
    start(async () => {
      const r = await analyzePlan();
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  if (props.analysis) {
    // key: un'analisi nuova riparte dalle sue proposte.
    // onDone: il messaggio finale resta visibile anche dopo che le proposte confermate spariscono.
    return <Review key={props.analysis.proposals.length + ":" + props.analysis.photoVersion} {...props} analysis={props.analysis} onDone={setResult} />;
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-2xl text-sm text-muted">
        <p>
          L&apos;app guarda la foto e propone da sola pontili e banchine, con una stima dei posti per lato e della misura delle barche. Tu controlli, correggi
          nomi e numeri, e con un clic nascono pontili e posti già disposti sulla foto.
        </p>
        {!props.available && (
          <p className="mt-2 text-warn">Non ancora attivo: va acceso una volta, con la chiave Anthropic, seguendo i passi in COME-LAVORIAMO.md.</p>
        )}
        {props.available && props.categories.length === 0 && (
          <p className="mt-2 text-warn">Servono prima le categorie dei posti (Impostazioni → Categorie).</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
        <button type="button" className="btn btn-primary" disabled={!props.available || pending || props.categories.length === 0} onClick={run}>
          {pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <ScanSearch size={16} aria-hidden="true" />}
          {pending ? "Analisi in corso…" : "Riconosci pontili e banchine"}
        </button>
        {pending && <p className="text-xs text-muted">Di solito ci vuole meno di un minuto.</p>}
      </div>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`rounded-md px-3 py-2 text-sm sm:basis-full ${result.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}

function Review({
  analysis,
  imageUrl,
  width,
  height,
  pxPerMeter,
  categories,
  usedCodes,
  placed,
  onDone,
}: {
  onDone: (result: { ok: boolean; message: string }) => void;
  analysis: StoredAnalysis;
  imageUrl: string;
  width: number;
  height: number;
  pxPerMeter: number | null;
  categories: DetectCategory[];
  usedCodes: string[];
  placed: { x: number; y: number; angle: number; lengthCm: number; beamCm: number }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [items, setItems] = useState<Item[]>(() => {
    const codes = suggestCodes(analysis.proposals.length, usedCodes);
    return analysis.proposals.map((p, i) => ({
      key: i,
      include: true,
      code: codes[i] ?? "",
      name: p.name,
      kind: p.kind,
      a: p.a,
      b: p.b,
      sides: p.sides.map((s) => ({ side: s.side, count: s.count, categoryId: categoryForLength(categories, s.boatLengthCm)?.id ?? categories[0]?.id ?? "" })),
    }));
  });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ key: number; end: "a" | "b" } | null>(null);

  const scale = pxPerMeter ?? analysis.scaleEstimate;
  const u = width / 1000;
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const update = (key: number, patch: Partial<Item>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const updateSide = (key: number, index: number, patch: Partial<ItemSide>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, sides: it.sides.map((s, i) => (i === index ? { ...s, ...patch } : s)) } : it)));

  // Problemi che impediscono la conferma, per struttura.
  const errors = useMemo(() => {
    const used = new Set(usedCodes.map((c) => c.toUpperCase()));
    const included = items.filter((it) => it.include);
    const map = new Map<number, string>();
    for (const it of included) {
      const code = it.code.trim().toUpperCase();
      if (!/^[A-Z0-9]{1,4}$/.test(code)) map.set(it.key, "La sigla va da 1 a 4 lettere o cifre.");
      else if (used.has(code)) map.set(it.key, `La sigla ${code} è già di un pontile esistente.`);
      else if (included.some((o) => o.key !== it.key && o.code.trim().toUpperCase() === code)) map.set(it.key, `La sigla ${code} è usata due volte.`);
      else if (!it.name.trim()) map.set(it.key, "Manca il nome.");
      else if (it.sides.some((s) => !(s.count >= 1 && s.count <= MAX_BERTHS_PER_SIDE))) map.set(it.key, `I posti per lato vanno da 1 a ${MAX_BERTHS_PER_SIDE}.`);
      else if (it.sides.some((s) => !categoryById.has(s.categoryId))) map.set(it.key, "Scegli la categoria.");
    }
    return map;
  }, [items, usedCodes, categoryById]);

  const included = items.filter((it) => it.include);
  const totalBerths = included.reduce((sum, it) => sum + it.sides.reduce((s, side) => s + (side.count || 0), 0), 0);

  // Anteprima dei posti, nelle misure reali se la scala è nota.
  const previews = useMemo(() => {
    if (!scale) return [];
    return items
      .filter((it) => it.include)
      .flatMap((it) =>
        planBerths(
          it.code.trim().toUpperCase() || "?",
          it.kind,
          it.a,
          it.b,
          it.sides
            .filter((s) => s.count >= 1 && categoryById.has(s.categoryId))
            .map((s) => ({ side: s.side, count: Math.min(s.count, MAX_BERTHS_PER_SIDE), lengthCm: categoryById.get(s.categoryId)!.maxLengthCm, beamCm: categoryById.get(s.categoryId)!.maxBeamCm })),
          scale,
        ).map((b) => ({ ...b, key: it.key })),
      );
  }, [items, scale, categoryById]);

  function toImage(e: { clientX: number; clientY: number }): Point {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(clamp(p.x, 0, width) * 10) / 10, y: Math.round(clamp(p.y, 0, height) * 10) / 10 };
  }

  function onHandleDown(e: PointerEvent<SVGCircleElement>, key: number, end: "a" | "b") {
    e.stopPropagation();
    drag.current = { key, end };
    setActive(key);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onHandleMove(e: PointerEvent<SVGCircleElement>) {
    const d = drag.current;
    if (!d) return;
    update(d.key, { [d.end]: toImage(e) } as Partial<Item>);
  }

  function confirm() {
    setResult(null);
    start(async () => {
      const r = await createFromProposals({
        scale: pxPerMeter ? null : scale,
        items: included.map((it) => ({ code: it.code.trim().toUpperCase(), name: it.name.trim(), kind: it.kind, a: it.a, b: it.b, sides: it.sides })),
      });
      setResult(r);
      if (r.ok) {
        onDone(r);
        router.refresh();
      }
    });
  }

  function discard() {
    start(async () => {
      onDone(await discardPlanAnalysis());
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0">
        <p className="mb-2 text-sm text-muted">
          Ogni linea arancione è una struttura riconosciuta, dalla radice (pallino pieno) alla testata. Trascina i pallini per correggerla; i rettangoli sono i
          posti che verranno creati.
        </p>
        <PlanZoom width={width} height={height}>
          <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full select-none" aria-label="Proposte sulla foto">
            <image href={imageUrl} width={width} height={height} />
            {scale &&
              placed.map((p, i) => {
                const { w, l } = berthSizePx(p, scale);
                return (
                  <rect
                    key={`placed-${i}`}
                    transform={`translate(${p.x} ${p.y}) rotate(${p.angle})`}
                    x={-w / 2}
                    y={-l / 2}
                    width={w}
                    height={l}
                    fill="#ffffff"
                    fillOpacity={0.35}
                    stroke="#ffffff"
                    strokeWidth={0.6 * u}
                  />
                );
              })}
            {scale &&
              previews.map((b) => {
                const { w, l } = berthSizePx(b, scale);
                return (
                  <rect
                    key={`${b.key}-${b.code}`}
                    transform={`translate(${b.placement.x} ${b.placement.y}) rotate(${b.placement.angle})`}
                    x={-w / 2}
                    y={-l / 2}
                    width={w}
                    height={l}
                    rx={0.6 * u}
                    fill="#d4502a"
                    fillOpacity={b.key === active ? 0.55 : 0.32}
                    stroke="#ffffff"
                    strokeWidth={0.7 * u}
                  />
                );
              })}
            {items.map((it, index) =>
              it.include ? (
                <g key={it.key} onClick={() => setActive(it.key)}>
                  <line x1={it.a.x} y1={it.a.y} x2={it.b.x} y2={it.b.y} stroke="#ffffff" strokeWidth={(it.key === active ? 5 : 3.5) * u} strokeLinecap="round" />
                  <line
                    x1={it.a.x}
                    y1={it.a.y}
                    x2={it.b.x}
                    y2={it.b.y}
                    stroke="#d4502a"
                    strokeWidth={(it.key === active ? 3 : 2) * u}
                    strokeDasharray={`${6 * u} ${4 * u}`}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={it.a.x}
                    cy={it.a.y}
                    r={6 * u}
                    fill="#d4502a"
                    stroke="#ffffff"
                    strokeWidth={1.6 * u}
                    style={{ cursor: "grab", touchAction: "none" }}
                    onPointerDown={(e) => onHandleDown(e, it.key, "a")}
                    onPointerMove={onHandleMove}
                    onPointerUp={() => (drag.current = null)}
                    onPointerCancel={() => (drag.current = null)}
                  >
                    <title>{`Radice di ${it.name}: trascina per spostarla`}</title>
                  </circle>
                  <circle
                    cx={it.b.x}
                    cy={it.b.y}
                    r={6 * u}
                    fill="#ffffff"
                    stroke="#d4502a"
                    strokeWidth={2 * u}
                    style={{ cursor: "grab", touchAction: "none" }}
                    onPointerDown={(e) => onHandleDown(e, it.key, "b")}
                    onPointerMove={onHandleMove}
                    onPointerUp={() => (drag.current = null)}
                    onPointerCancel={() => (drag.current = null)}
                  >
                    <title>{`Testata di ${it.name}: trascina per spostarla`}</title>
                  </circle>
                  <text
                    x={(it.a.x + it.b.x) / 2}
                    y={(it.a.y + it.b.y) / 2 - 8 * u}
                    textAnchor="middle"
                    fontSize={13 * u}
                    fontWeight={700}
                    fill="#ffffff"
                    stroke="#12283a"
                    strokeWidth={3 * u}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {it.code.trim().toUpperCase() || index + 1}
                  </text>
                </g>
              ) : null,
            )}
          </svg>
        </PlanZoom>
      </div>

      <aside className="space-y-3 xl:max-h-[85vh] xl:overflow-y-auto xl:pr-1">
        <div className="rounded-md bg-sea-soft px-3 py-2 text-sm text-sea-dark">
          {pxPerMeter ? (
            <>Scala della foto: 1 metro = {pxPerMeter.toLocaleString("it-IT", { maximumFractionDigits: 2 })} pixel.</>
          ) : analysis.scaleEstimate ? (
            <>
              Scala stimata dall&apos;analisi: 1 metro ≈ {analysis.scaleEstimate.toLocaleString("it-IT", { maximumFractionDigits: 2 })} pixel. Per una misura
              esatta impostala nell&apos;editor qui sotto prima di confermare.
            </>
          ) : (
            <>Scala non nota: impostala nell&apos;editor qui sotto e salva, poi torna qui per confermare.</>
          )}
        </div>
        {analysis.notes && <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{analysis.notes}</p>}

        <ul className="space-y-3">
          {items.map((it, index) => {
            const error = it.include ? errors.get(it.key) : undefined;
            const free: Side | null = it.sides.length === 1 ? (it.sides[0].side === "sx" ? "dx" : "sx") : null;
            return (
              <li
                key={it.key}
                className={`card p-3 ${it.key === active ? "border-buoy" : ""} ${it.include ? "" : "opacity-60"}`}
                onFocusCapture={() => setActive(it.key)}
                onMouseEnter={() => setActive(it.key)}
              >
                <div className="flex items-start gap-2">
                  <input
                    id={`incl-${it.key}`}
                    type="checkbox"
                    className="mt-2.5 size-[18px] shrink-0 accent-sea"
                    checked={it.include}
                    onChange={(e) => update(it.key, { include: e.target.checked })}
                    aria-label={`Includi la struttura ${index + 1}`}
                  />
                  <div className="grid min-w-0 flex-1 grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
                    <div>
                      <label className="label" htmlFor={`code-${it.key}`}>
                        Sigla
                      </label>
                      <input
                        id={`code-${it.key}`}
                        className="input px-2 uppercase"
                        maxLength={4}
                        value={it.code}
                        disabled={!it.include}
                        onChange={(e) => update(it.key, { code: e.target.value.toUpperCase() })}
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="label" htmlFor={`name-${it.key}`}>
                        Nome
                      </label>
                      <input id={`name-${it.key}`} className="input" value={it.name} disabled={!it.include} onChange={(e) => update(it.key, { name: e.target.value })} />
                    </div>
                  </div>
                </div>

                {it.include && (
                  <div className="mt-3 space-y-2 pl-7">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`kind-${it.key}`}>
                        Tipo
                      </label>
                      <select
                        id={`kind-${it.key}`}
                        className="input w-auto py-1 text-sm"
                        value={it.kind}
                        onChange={(e) => update(it.key, { kind: e.target.value as StructureKind })}
                      >
                        <option value="pontile">Pontile</option>
                        <option value="banchina">Banchina</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => update(it.key, { sides: it.sides.map((s) => ({ ...s, side: s.side === "sx" ? "dx" : "sx" })) })}
                      >
                        <ArrowLeftRight size={14} aria-hidden="true" />
                        Inverti i lati
                      </button>
                    </div>

                    {it.sides.map((s, i) => (
                      <div key={s.side} className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-end gap-2">
                        <div className="min-w-0">
                          <label className="label" htmlFor={`cat-${it.key}-${s.side}`}>
                            {SIDE_LABEL[s.side]}
                          </label>
                          <select
                            id={`cat-${it.key}-${s.side}`}
                            className="input py-1 text-sm"
                            value={s.categoryId}
                            onChange={(e) => updateSide(it.key, i, { categoryId: e.target.value })}
                          >
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label" htmlFor={`count-${it.key}-${s.side}`}>
                            Posti
                          </label>
                          <input
                            id={`count-${it.key}-${s.side}`}
                            className="input px-2 py-1 text-sm tabular-nums"
                            inputMode="numeric"
                            value={s.count ? String(s.count) : ""}
                            onChange={(e) => updateSide(it.key, i, { count: Number.parseInt(e.target.value.replace(/\D/g, ""), 10) || 0 })}
                          />
                        </div>
                        {it.sides.length > 1 ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm mb-0.5 px-2"
                            aria-label={`Togli il ${SIDE_LABEL[s.side].toLowerCase()}`}
                            onClick={() => update(it.key, { sides: it.sides.filter((_, j) => j !== i) })}
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    ))}
                    {free && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => update(it.key, { sides: [...it.sides, { side: free, count: it.sides[0].count, categoryId: it.sides[0].categoryId }] })}
                      >
                        <Plus size={14} aria-hidden="true" />
                        Aggiungi il {SIDE_LABEL[free].toLowerCase()}
                      </button>
                    )}
                    {error && <p className="field-error">{error}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="space-y-2 border-t border-line pt-3">
          <button type="button" className="btn btn-primary w-full" disabled={pending || included.length === 0 || errors.size > 0 || !scale} onClick={confirm}>
            {pending ? "Creazione in corso…" : `Crea ${included.length} ${included.length === 1 ? "struttura" : "strutture"} e ${totalBerths} posti`}
          </button>
          <button type="button" className="btn btn-ghost w-full" disabled={pending} onClick={discard}>
            Scarta le proposte
          </button>
          {result && (
            <p role={result.ok ? "status" : "alert"} className={`rounded-md px-3 py-2 text-sm ${result.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
              {result.message}
            </p>
          )}
          <p className="text-xs text-muted">I numeri sono stime dalla foto: controllali con l&apos;elenco reale dei posti prima di confermare.</p>
        </div>
      </aside>
    </div>
  );
}
