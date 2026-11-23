"use client";

import { startTransition, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { GripVertical, Plus, Search } from "@/components/icons";
import { STATE_LABEL } from "@/lib/berth-states";
import { reorderPiers } from "@/server/settings-actions";
import { PierForm } from "../settings-forms";
import { BerthPanel } from "./berth-panel";
import { Drawer } from "./drawer";
import { PierDetail } from "./pier-detail";
import { stateCounts } from "./states";
import type { ManagerBerth, ManagerCategory, ManagerPier, ManagerUnit } from "./types";

/**
 * Pontili e posti: a sinistra l'elenco dei pontili (con occupazione di oggi e ordine da trascinare), a destra la scheda del pontile
 * scelto; sul telefono una cosa per volta. In alto «Trova un posto» e «Nuovo pontile».
 */
export function PiersManager({
  piers: initialPiers,
  berths,
  categories,
  hasPlan,
  initialPierId,
}: {
  piers: ManagerPier[];
  berths: ManagerBerth[];
  categories: ManagerCategory[];
  hasPlan: boolean;
  initialPierId: string | null;
}) {
  const [order, setOrder] = useState(() => initialPiers.map((p) => p.id));
  const [currentId, setCurrentId] = useState(initialPierId ?? initialPiers[0]?.id ?? null);
  // Sul telefono: elenco o scheda (si apre la scheda se l'indirizzo indica già un pontile).
  const [showDetail, setShowDetail] = useState(Boolean(initialPierId));
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<string | null>(null);
  const [berthId, setBerthId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const drag = useRef<{ id: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // Quando la pagina si aggiorna (pontili aggiunti, uniti, eliminati) l'ordine riparte da quello salvato.
  const serverOrder = initialPiers.map((p) => p.id).join(",");
  const [seenOrder, setSeenOrder] = useState(serverOrder);
  if (seenOrder !== serverOrder) {
    setSeenOrder(serverOrder);
    setOrder(serverOrder ? serverOrder.split(",") : []);
  }

  const byId = useMemo(() => new Map(initialPiers.map((p) => [p.id, p])), [initialPiers]);
  const piers = order.map((id) => byId.get(id)).filter((p): p is ManagerPier => Boolean(p));
  const current = (currentId && byId.get(currentId)) || piers[0] || null;
  const existingCodes = useMemo(() => new Set(berths.map((b) => b.code.toUpperCase())), [berths]);
  const total = stateCounts(berths);

  function open(id: string) {
    setCurrentId(id);
    setShowDetail(true);
    setFound(null);
    window.history.replaceState(null, "", `?pontile=${id}`);
  }

  // «Trova un posto»: col codice esatto apre il pontile ed evidenzia il posto; altrimenti suggerisce.
  const q = query.trim().toUpperCase();
  const exact = q ? berths.find((b) => b.code.toUpperCase() === q) : undefined;
  const partial = q && !exact ? berths.filter((b) => b.code.toUpperCase().startsWith(q)).slice(0, 8) : [];
  function search(value: string) {
    setQuery(value);
    const hit = berths.find((b) => b.code.toUpperCase() === value.trim().toUpperCase());
    if (!hit) return setFound(null);
    setCurrentId(hit.pierId);
    setShowDetail(true);
    setFound(hit.id);
  }

  // Ordine: si trascina la maniglia; al rilascio si salva.
  function onHandleDown(e: PointerEvent, id: string) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id };
    setDragging(id);
  }
  function onHandleMove(e: PointerEvent) {
    if (!drag.current) return;
    const over = document.elementsFromPoint(e.clientX, e.clientY).map((el) => el.closest<HTMLElement>("[data-pier-row]")).find(Boolean);
    const overId = over?.dataset.pierRow;
    if (!overId || overId === drag.current.id) return;
    setOrder((prev) => {
      const next = prev.filter((x) => x !== drag.current!.id);
      next.splice(prev.indexOf(overId), 0, drag.current!.id);
      return next;
    });
  }
  function onHandleUp() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(null);
    if (order.join(",") === serverOrder) return;
    const data = new FormData();
    data.set("ids", order.join(","));
    startTransition(async () => {
      const result = await reorderPiers(undefined, data);
      setOrderError(result?.ok ? null : (result?.message ?? "Ordine non salvato."));
    });
  }

  const units = (pier: ManagerPier): ManagerUnit[] => {
    const own = berths.filter((b) => b.pierId === pier.id);
    if (pier.sections.length === 0) return [{ sectionId: null, title: "Posti", label: "", berths: own }];
    const known = new Set(pier.sections.map((s) => s.id));
    const loose = own.filter((b) => !b.sectionId || !known.has(b.sectionId));
    return [
      ...pier.sections.map((s) => ({ sectionId: s.id, title: `Tratto ${s.label}`, label: s.label, berths: own.filter((b) => b.sectionId === s.id) })),
      ...(loose.length ? [{ sectionId: null, title: "Posti fuori dai tratti", label: "", berths: loose }] : []),
    ];
  };

  const openBerth = berthId ? berths.find((b) => b.id === berthId) : undefined;
  const openBerthPier = openBerth ? byId.get(openBerth.pierId) : undefined;
  const openBerthSection = openBerth && openBerthPier?.sections.find((s) => s.id === openBerth.sectionId);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" aria-hidden="true" />
          <input
            className="input pl-10"
            placeholder="Trova un posto (es. CN7)"
            aria-label="Trova un posto"
            value={query}
            onChange={(e) => search(e.target.value)}
            autoComplete="off"
          />
        </div>
        <p className="text-sm text-muted" aria-live="polite">
          {exact
            ? `${exact.code} è su ${byId.get(exact.pierId)?.name ?? ""} · ${STATE_LABEL[exact.state]}`
            : partial.length > 0
              ? `Forse: ${partial.map((b) => b.code).join(", ")}`
              : q
                ? "Nessun posto con questo codice."
                : ""}
        </p>
        <button type="button" className="btn btn-primary ml-auto" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden="true" /> Nuovo pontile
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className={showDetail ? "max-lg:hidden" : ""} aria-label="Pontili e banchine">
          <div className="card overflow-hidden">
            <div className="border-b border-line-soft bg-paper px-4 py-3">
              <p className="flex flex-wrap justify-between gap-2 text-sm text-muted">
                <span>
                  <b className="text-ink">Totale porto</b> · {total.total} posti
                </span>
                <span>
                  <b className="text-ink tabular-nums">{total.busy}</b> {total.busy === 1 ? "occupato" : "occupati"} · <b className="text-ink tabular-nums">{total.free}</b>{" "}
                  {total.free === 1 ? "libero" : "liberi"}
                </span>
              </p>
              <OccupancyBar c={total} />
              <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted">
                <Key className="bg-sea">Occupati</Key>
                <Key className="bg-ok/45">Liberi</Key>
                <Key className="bg-line">Non disponibili</Key>
              </p>
            </div>
            {piers.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">Nessun pontile: comincia da «Nuovo pontile».</p>
            ) : (
              <ul onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
                {piers.map((p) => {
                  const c = stateCounts(berths.filter((b) => b.pierId === p.id));
                  const on = current?.id === p.id;
                  return (
                    <li
                      key={p.id}
                      data-pier-row={p.id}
                      className={`relative flex items-stretch border-b border-line-soft last:border-b-0 ${on ? "bg-sea-soft" : "bg-card hover:bg-white"} ${
                        dragging === p.id ? "opacity-60 shadow-lg" : ""
                      }`}
                    >
                      {on && <span className="absolute inset-y-2 left-0 w-[3px] rounded bg-sea" aria-hidden="true" />}
                      <span
                        className="flex w-8 shrink-0 cursor-grab touch-none items-center justify-center text-faint hover:text-muted"
                        onPointerDown={(e) => onHandleDown(e, p.id)}
                        title="Trascina per cambiare l'ordine"
                        aria-hidden="true"
                      >
                        <GripVertical size={18} />
                      </span>
                      <button type="button" className="min-w-0 flex-1 py-3 pr-3 text-left" onClick={() => open(p.id)} aria-current={on ? "true" : undefined}>
                        <span className="flex items-baseline gap-1.5">
                          <span className="truncate font-semibold text-ink">{p.name}</span>
                          <span className="text-sm text-faint">{p.code}</span>
                          <span className={`badge ml-auto ${p.baseRate ? "bg-line-soft text-muted" : "bg-sea-soft text-sea-dark"}`}>{p.baseRate ? "Base" : "Propri"}</span>
                        </span>
                        <OccupancyBar c={c} />
                        <span className="mt-1 flex justify-between gap-2 text-xs text-muted tabular-nums">
                          <span>
                            {c.total} {c.total === 1 ? "posto" : "posti"}
                            {p.sections.length > 1 ? ` · ${p.sections.length} tratti` : ""}
                          </span>
                          <span>
                            {c.busy} occ. · {c.free} liberi{c.stopped ? ` · ${c.stopped} n.d.` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {piers.length > 1 && <p className="mt-2 px-1 text-xs text-muted">Trascina ⠿ per cambiare l&apos;ordine: vale per mappa, elenchi e tariffe.</p>}
          {orderError && (
            <p className="mt-2 px-1 text-sm text-bad" role="alert">
              {orderError}
            </p>
          )}
        </aside>

        <div className={showDetail ? "" : "max-lg:hidden"}>
          {current ? (
            <PierDetail
              key={current.id}
              pier={current}
              units={units(current)}
              categories={categories}
              piers={piers}
              existingCodes={existingCodes}
              hasPlan={hasPlan}
              found={found && berths.find((b) => b.id === found)?.pierId === current.id ? found : null}
              isFirst={piers[0]?.id === current.id}
              isLast={piers[piers.length - 1]?.id === current.id}
              onBack={() => setShowDetail(false)}
              onOpenBerth={setBerthId}
            />
          ) : (
            <div className="card px-4 py-6 text-sm text-muted">Crea il primo pontile o banchina con «Nuovo pontile».</div>
          )}
        </div>
      </div>

      {openBerth && (
        <BerthPanel
          key={openBerth.id}
          berth={openBerth}
          where={`${openBerthPier?.name ?? ""}${openBerthSection ? ` · tratto ${openBerthSection.label}` : ""}`}
          categories={categories}
          onClose={() => setBerthId(null)}
        />
      )}

      {creating && (
        <Drawer title="Nuovo pontile o banchina" onClose={() => setCreating(false)}>
          <PierForm nextOrder={piers.length} others={piers.map((p) => ({ id: p.id, code: p.code, name: p.name }))} />
        </Drawer>
      )}
    </>
  );
}

function OccupancyBar({ c }: { c: { total: number; busy: number; free: number; stopped: number } }) {
  const t = c.total || 1;
  return (
    <span
      className="mt-1.5 flex h-[7px] overflow-hidden rounded-full bg-line-soft"
      role="img"
      aria-label={`${c.busy} occupati, ${c.free} liberi, ${c.stopped} non disponibili`}
    >
      <span className="bg-sea" style={{ width: `${(c.busy / t) * 100}%` }} />
      <span className="bg-ok/45" style={{ width: `${(c.free / t) * 100}%` }} />
      <span className="bg-line" style={{ width: `${(c.stopped / t) * 100}%` }} />
    </span>
  );
}

function Key({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <i className={`inline-block h-2.5 w-2.5 rounded-sm ${className}`} aria-hidden="true" />
      {children}
    </span>
  );
}
