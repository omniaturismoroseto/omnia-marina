"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { ActionButton, Form, FormMessage, SelectField, Submit } from "@/components/form";
import { ChevronLeft, Ellipsis, Plus } from "@/components/icons";
import { STATE_LABEL } from "@/lib/berth-states";
import { compareCodes } from "@/lib/berth-codes";
import { unitPositions } from "@/lib/plan-units";
import { deletePier, mergePierInto, movePier } from "@/server/settings-actions";
import { PierForm } from "../settings-forms";
import { AddBerthsPanel } from "./add-berths";
import { BulkCodesForm, BulkDeleteForm, BulkEditForm, BulkSectionForm, pickedSummary } from "./bulk-forms";
import { Drawer } from "./drawer";
import { STATE_CELL, STATE_ORDER, stateCounts } from "./states";
import type { ManagerBerth, ManagerCategory, ManagerPier, ManagerUnit } from "./types";
import { ArrangeForm, DissolveSectionButton, RenameSectionForm, SplitAtForm, SplitSectionForm } from "./unit-tools";

type Bulk = "edit" | "codes" | "section" | "delete";
type UnitAction = "arrange" | "divide" | "rename" | "split";

const unitKey = (u: ManagerUnit) => u.sectionId ?? "pontile";

// Lettere più usate nei codici (CN1, CN2 → CN), per proporre la sigla dei posti nuovi.
function commonPrefix(list: { code: string }[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const b of list) {
    const p = b.code.replace(/\d+$/, "");
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || fallback;
}

function nextNumber(prefix: string, codes: string[]): number {
  const numbers = codes.map((c) => (c.startsWith(prefix) ? Number.parseInt(c.slice(prefix.length), 10) : Number.NaN)).filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

/** Scheda di un pontile: riepilogo, comandi, posti per tratto colorati con lo stato di oggi, scelta di più posti. */
export function PierDetail({
  pier,
  units,
  categories,
  piers,
  existingCodes,
  hasPlan,
  found,
  isFirst,
  isLast,
  onBack,
  onOpenBerth,
}: {
  pier: ManagerPier;
  units: ManagerUnit[];
  categories: ManagerCategory[];
  piers: ManagerPier[];
  existingCodes: Set<string>;
  hasPlan: boolean;
  /** Posto trovato con «Trova un posto»: si evidenzia. */
  found: string | null;
  isFirst: boolean;
  isLast: boolean;
  onBack: () => void;
  onOpenBerth: (id: string) => void;
}) {
  const all = useMemo(() => units.flatMap((u) => u.berths).sort((a, b) => compareCodes(a.code, b.code)), [units]);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lastPick, setLastPick] = useState<string | null>(null);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<"rename" | "merge" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [add, setAdd] = useState<{ sectionId: string | null } | null>(null);
  const [unitAction, setUnitAction] = useState<{ key: string; action: UnitAction } | null>(null);
  const [range, setRange] = useState({ from: "", to: "" });
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = all.filter((b) => picked.has(b.id));
  const c = stateCounts(all);
  const multi = units.some((u) => u.sectionId);
  const byCategory = categories.map((cat) => ({ cat, n: all.filter((b) => b.categoryId === cat.id).length })).filter((x) => x.n > 0);
  const without = all.filter((b) => !b.categoryId || !categories.some((cat) => cat.id === b.categoryId)).length;
  const firstUnitId = units[0]?.sectionId ?? pier.id;
  const codes = useMemo(() => [...existingCodes], [existingCodes]);

  // Chiude il menu toccando fuori.
  useEffect(() => {
    if (!menu) return;
    const close = (e: globalThis.MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  // Il posto trovato si porta in vista.
  useEffect(() => {
    if (!found) return;
    document.querySelector(`[data-berth="${found}"]`)?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [found]);

  function endSelection() {
    setSelecting(false);
    setPicked(new Set());
    setBulk(null);
  }

  function pickMany(list: ManagerBerth[]) {
    setPicked((prev) => new Set([...prev, ...list.map((b) => b.id)]));
  }

  function onBerth(e: MouseEvent, b: ManagerBerth) {
    if (!selecting) return onOpenBerth(b.id);
    if (e.shiftKey && lastPick) {
      const i = all.findIndex((x) => x.id === lastPick);
      const j = all.findIndex((x) => x.id === b.id);
      pickMany(all.slice(Math.min(i, j), Math.max(i, j) + 1));
    } else {
      setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(b.id)) next.delete(b.id);
        else next.add(b.id);
        return next;
      });
    }
    setLastPick(b.id);
  }

  function pickRange() {
    const from = range.from.trim().toUpperCase();
    const to = range.to.trim().toUpperCase();
    const i = all.findIndex((b) => b.code.toUpperCase() === from);
    const j = all.findIndex((b) => b.code.toUpperCase() === to);
    if (i >= 0 && j >= 0) pickMany(all.slice(Math.min(i, j), Math.max(i, j) + 1));
  }

  const linkBtn = "btn btn-secondary btn-sm";

  return (
    <section className="card min-w-0" aria-label={pier.name}>
      {/* Intestazione */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-4 py-3">
        <button type="button" className="btn btn-ghost btn-sm -ml-2 lg:hidden" onClick={onBack}>
          <ChevronLeft size={18} aria-hidden="true" /> Pontili
        </button>
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
          {pier.name} <span className="text-[15px] font-medium text-faint">{pier.code}</span>
          <Link href={`/tariffe?pontile=${pier.id}`} title="Tariffa del pontile" className={`badge no-underline ${pier.baseRate ? "bg-line-soft text-muted" : "bg-sea-soft text-sea-dark"}`}>
            {pier.baseRate ? "Tariffa base" : "Prezzi propri"}
          </Link>
        </h2>
        <div className="relative ml-auto flex flex-wrap items-center gap-2" ref={menuRef}>
          <Link href="/mappa" className={linkBtn}>
            Vedi sulla mappa
          </Link>
          {hasPlan && (
            <Link href={`/impostazioni/pianta?parte=posti&struttura=${firstUnitId}#editor`} className={linkBtn}>
              Apri nella pianta
            </Link>
          )}
          <button type="button" className={linkBtn} aria-haspopup="menu" aria-expanded={menu} aria-label="Altre azioni del pontile" onClick={() => setMenu((v) => !v)}>
            <Ellipsis size={18} aria-hidden="true" />
          </button>
          {menu && (
            <div role="menu" className="absolute top-full right-0 z-30 mt-1.5 w-64 rounded-lg border border-line bg-card p-1 shadow-xl">
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  setDialog("rename");
                }}
              >
                Rinomina e sigla
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  setDialog("merge");
                }}
                disabled={piers.length < 2}
              >
                Unisci con un altro pontile…
              </MenuItem>
              <Link role="menuitem" href={`/tariffe?pontile=${pier.id}`} className="block rounded-md px-3 py-2 text-sm text-ink no-underline hover:bg-line-soft">
                Tariffa del pontile
              </Link>
              {!isFirst && (
                <ActionButton action={movePier} fields={{ pierId: pier.id, direction: "su" }} variant="ghost" size="sm" className="w-full justify-start text-ink">
                  Sposta in su nell&apos;elenco
                </ActionButton>
              )}
              {!isLast && (
                <ActionButton action={movePier} fields={{ pierId: pier.id, direction: "giu" }} variant="ghost" size="sm" className="w-full justify-start text-ink">
                  Sposta in giù nell&apos;elenco
                </ActionButton>
              )}
              <hr className="my-1 border-line-soft" />
              <MenuItem
                danger
                onClick={() => {
                  setMenu(false);
                  setConfirmDelete(true);
                }}
              >
                Elimina il pontile
              </MenuItem>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {confirmDelete && <DeleteConfirm pierId={pier.id} name={pier.name} count={all.length} onCancel={() => setConfirmDelete(false)} />}

        {/* Riepilogo */}
        <div className="space-y-1 text-sm text-muted">
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <b className="text-ink tabular-nums">{c.total}</b> {c.total === 1 ? "posto" : "posti"}
            </span>
            <span>
              <b className="text-ink tabular-nums">{c.busy}</b> {c.busy === 1 ? "occupato" : "occupati"}
            </span>
            <span>
              <b className="text-ink tabular-nums">{c.free}</b> {c.free === 1 ? "libero" : "liberi"}
            </span>
            <span>
              <b className="text-ink tabular-nums">{c.stopped}</b> non disponibili
            </span>
            <span>
              <b className="text-ink tabular-nums">{pier.contracts}</b> contratti attivi
            </span>
          </p>
          {(byCategory.length > 0 || without > 0) && (
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              {byCategory.map(({ cat, n }) => (
                <span key={cat.id}>
                  {cat.name}: <b className="text-ink tabular-nums">{n}</b>
                </span>
              ))}
              {without > 0 && (
                <span>
                  Senza categoria: <b className="text-ink tabular-nums">{without}</b>
                </span>
              )}
            </p>
          )}
        </div>

        {/* Comandi */}
        <div className="flex flex-wrap items-center gap-2">
          {all.length > 0 &&
            (selecting ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={endSelection}>
                Fine selezione
              </button>
            ) : (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelecting(true)}>
                Scegli più posti
              </button>
            ))}
          <span className="flex-1" />
          <button type="button" className={`btn btn-sm ${add ? "btn-secondary" : "btn-primary"}`} onClick={() => setAdd(add ? null : { sectionId: null })}>
            {add ? (
              "Chiudi"
            ) : (
              <>
                <Plus size={16} aria-hidden="true" /> Aggiungi posti
              </>
            )}
          </button>
        </div>

        {selecting && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-sea-soft px-3 py-2 text-sm text-sea-dark" aria-label="Scelta rapida">
            <span>Scegli:</span>
            <Chip onClick={() => pickMany(all)}>Tutti</Chip>
            <Chip onClick={() => pickMany(all.filter((b) => b.side === "sx"))}>Lato sinistro</Chip>
            <Chip onClick={() => pickMany(all.filter((b) => b.side === "dx"))}>Lato destro</Chip>
            {multi && units.map((u) => <Chip key={unitKey(u)} onClick={() => pickMany(u.berths)}>{u.title}</Chip>)}
            {byCategory.map(({ cat }) => (
              <Chip key={cat.id} onClick={() => pickMany(all.filter((b) => b.categoryId === cat.id))}>
                {cat.name}
              </Chip>
            ))}
            <span className="inline-flex items-center gap-1">
              <label htmlFor={`da-${pier.id}`}>da</label>
              <input id={`da-${pier.id}`} className="input w-20 !min-h-8 !py-1 text-sm" placeholder={all[0]?.code} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              <label htmlFor={`a-${pier.id}`}>a</label>
              <input id={`a-${pier.id}`} className="input w-20 !min-h-8 !py-1 text-sm" placeholder={all[Math.min(5, all.length - 1)]?.code} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              <Chip onClick={pickRange}>Scegli</Chip>
            </span>
            <Chip onClick={() => setPicked(new Set())}>Nessuno</Chip>
            <span className="basis-full text-xs text-muted">Tocca i posti per sceglierli; con Maiuscole premuto scegli tutti quelli tra due posti.</span>
          </div>
        )}

        {add && (
          <AddBerthsPanel
            key={add.sectionId ?? "pontile"}
            pierId={pier.id}
            pierName={pier.name}
            prefix={commonPrefix(units.find((u) => u.sectionId === add.sectionId)?.berths ?? all, pier.code)}
            nextNumber={nextNumber(commonPrefix(units.find((u) => u.sectionId === add.sectionId)?.berths ?? all, pier.code), codes)}
            sections={pier.sections}
            sectionId={add.sectionId}
            categories={categories}
            existingCodes={existingCodes}
            hasPlan={hasPlan}
          />
        )}

        {all.length > 0 && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda">
            {STATE_ORDER.filter((s) => all.some((b) => b.state === s)).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <i className={`inline-block h-3 w-3.5 rounded-sm border ${STATE_CELL[s]}`} aria-hidden="true" />
                {STATE_LABEL[s]}
              </span>
            ))}
          </p>
        )}

        {multi && <p className="text-sm text-muted">Pontile in più tratti (unito o diviso): per elenchi, codici e tariffe è uno solo, ma ogni tratto si gestisce anche da sé e sulla pianta si sposta da solo.</p>}

        {all.length === 0 && !add && <p className="text-sm text-muted">Questo pontile non ha ancora posti: usa «Aggiungi posti».</p>}

        {/* Posti, tratto per tratto */}
        {units.map((u) => {
          const uc = stateCounts(u.berths);
          const key = unitKey(u);
          const open = unitAction?.key === key ? unitAction.action : null;
          const toggle = (action: UnitAction) => setUnitAction(open === action ? null : { key, action });
          return (
            <section key={key} className="rounded-md border border-line-soft bg-white/70 p-3" aria-label={u.title}>
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h3 className="text-sm font-semibold text-ink">{u.title}</h3>
                <span className="text-sm text-muted">
                  {uc.total} {uc.total === 1 ? "posto" : "posti"} · {uc.busy} {uc.busy === 1 ? "occupato" : "occupati"} · {uc.free}{" "}
                  {uc.free === 1 ? "libero" : "liberi"}
                </span>
                <span className="flex flex-1 flex-wrap justify-end gap-x-3 gap-y-1 text-sm">
                  {u.berths.length > 0 && (
                    <UnitLink active={open === "arrange"} onClick={() => toggle("arrange")}>
                      Disposizione
                    </UnitLink>
                  )}
                  {u.berths.length > 1 && (
                    <UnitLink active={open === "divide"} onClick={() => toggle("divide")}>
                      Dividi
                    </UnitLink>
                  )}
                  {multi && (
                    <UnitLink active={add?.sectionId === u.sectionId} onClick={() => setAdd(add?.sectionId === u.sectionId ? null : { sectionId: u.sectionId })}>
                      Aggiungi posti
                    </UnitLink>
                  )}
                  {u.sectionId && (
                    <>
                      <UnitLink active={open === "rename"} onClick={() => toggle("rename")}>
                        Rinomina
                      </UnitLink>
                      <UnitLink active={open === "split"} onClick={() => toggle("split")}>
                        Rendi pontile a sé
                      </UnitLink>
                    </>
                  )}
                  {hasPlan && (
                    <Link href={`/impostazioni/pianta?parte=posti&struttura=${u.sectionId ?? pier.id}#editor`} className="link">
                      Apri nella pianta
                    </Link>
                  )}
                  {u.sectionId && <DissolveSectionButton sectionId={u.sectionId} label={u.label} />}
                </span>
              </div>
              {open && (
                <div className="mb-3 rounded-md border border-line-soft bg-paper p-3">
                  {open === "arrange" && <ArrangeForm pierId={pier.id} sectionId={u.sectionId} hasPlan={hasPlan} />}
                  {open === "divide" && (
                    <SplitAtForm
                      pierId={pier.id}
                      sectionId={u.sectionId}
                      berths={[...u.berths].sort((a, b) => compareCodes(a.code, b.code))}
                      first={u.label || "1"}
                      second={u.label ? `${u.label} 2` : "2"}
                    />
                  )}
                  {open === "rename" && u.sectionId && <RenameSectionForm sectionId={u.sectionId} label={u.label} />}
                  {open === "split" && u.sectionId && <SplitSectionForm sectionId={u.sectionId} code={u.label.slice(0, 4).toUpperCase()} name={`${pier.name} ${u.label}`} />}
                </div>
              )}
              <BerthStrip berths={u.berths} picked={picked} selecting={selecting} found={found} onBerth={onBerth} />
            </section>
          );
        })}
      </div>

      {/* Barra dei posti scelti */}
      {selecting && (
        // Sul telefono sopra la barra di navigazione in basso; sul computer a destra del menu laterale.
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-40 flex justify-center px-4 lg:bottom-4 lg:left-60">
          <div className="flex max-w-full flex-wrap items-center gap-1.5 rounded-xl bg-deep px-3 py-2 text-white shadow-2xl" role="toolbar" aria-label="Azioni sui posti scelti">
            <span className="mr-1 text-sm font-semibold tabular-nums">
              {selected.length === 0 ? "Tocca i posti da scegliere" : selected.length === 1 ? "1 posto scelto" : `${selected.length} posti scelti`}
            </span>
            {(
              [
                ["edit", "Modifica"],
                ["codes", "Codici"],
                ["section", "Tratto"],
                ["delete", "Elimina"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                disabled={selected.length === 0}
                onClick={() => setBulk(kind)}
                className={`btn btn-sm border-white/25 bg-white/5 hover:bg-white/15 ${kind === "delete" ? "text-[#ffb4a8]" : "text-white"}`}
              >
                {label}
              </button>
            ))}
            <button type="button" className="btn btn-sm border-white/25 bg-white/5 text-white hover:bg-white/15" onClick={endSelection} aria-label="Fine selezione">
              Fine
            </button>
          </div>
        </div>
      )}

      {bulk && selected.length > 0 && (
        <Drawer
          title={{ edit: "Modifica i posti scelti", codes: "Cambia i codici", section: "Fai un tratto della pianta", delete: "Elimina i posti scelti" }[bulk]}
          subtitle={`${selected.length === 1 ? "1 posto" : `${selected.length} posti`}: ${pickedSummary(selected)}`}
          onClose={() => setBulk(null)}
        >
          {bulk === "edit" && <BulkEditForm pierId={pier.id} berths={selected} categories={categories} />}
          {bulk === "codes" && <BulkCodesForm pierId={pier.id} berths={selected} prefix={commonPrefix(selected, pier.code)} />}
          {bulk === "section" && <BulkSectionForm pierId={pier.id} berths={selected} />}
          {bulk === "delete" && <BulkDeleteForm pierId={pier.id} berths={selected} />}
        </Drawer>
      )}

      {dialog === "rename" && (
        <Drawer title={`Rinomina ${pier.name}`} onClose={() => setDialog(null)}>
          <PierForm pier={pier} nextOrder={pier.sortOrder} others={piers.map((p) => ({ id: p.id, code: p.code, name: p.name }))} />
        </Drawer>
      )}
      {dialog === "merge" && (
        <Drawer title={`Unisci ${pier.name}`} onClose={() => setDialog(null)}>
          <Form action={mergePierInto} className="space-y-4">
            <input type="hidden" name="pierId" value={pier.id} />
            <p className="text-sm text-muted">
              I posti di {pier.name} passano al pontile scelto con codici, misure e contratti, e {pier.name} sparisce dagli elenchi. Sulla pianta
              restano un tratto a sé, che si sposta da solo e si può separare di nuovo.
            </p>
            <SelectField
              name="targetId"
              label="Unisci a"
              options={piers.filter((p) => p.id !== pier.id).map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
            />
            <Submit>Unisci</Submit>
            <FormMessage />
          </Form>
        </Drawer>
      )}
    </section>
  );
}

function MenuItem({ children, onClick, danger, disabled }: { children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-line-soft disabled:opacity-50 ${danger ? "text-bad" : "text-ink"}`}
    >
      {children}
    </button>
  );
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full border border-sea/30 bg-card px-2.5 py-0.5 text-sm text-sea-dark hover:bg-white">
      {children}
    </button>
  );
}

function UnitLink({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`link ${active ? "font-semibold" : ""}`}>
      {children}
    </button>
  );
}

// Larghezza delle celle dei posti (px): si allargano fino a CELL_MAX per riempire la riga; sotto CELL_MIN il pontile va a capo.
const CELL_MIN = 46;
const CELL_MAX = 64;
const GAP = 4;

// Larghezza disponibile del riquadro (si aggiorna quando cambia lo schermo).
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// Primo e ultimo codice di un gruppo di posti (R23–R33), per riconoscere i pezzi di un pontile andato a capo.
function codeRange(list: ManagerBerth[]): string {
  if (list.length === 0) return "";
  const sorted = [...list].sort((a, b) => compareCodes(a.code, b.code));
  return sorted.length === 1 ? sorted[0].code : `${sorted[0].code}–${sorted[sorted.length - 1].code}`;
}

/**
 * Posti su due file come sul pontile: sopra il lato sinistro, sotto il destro, dalla radice alla testata. Le celle si adattano
 * alla larghezza dello schermo, senza barra di scorrimento; se non ci stanno il pontile (o il tratto) va a capo in più pezzi,
 * ognuno con i suoi codici scritti sopra.
 */
function BerthStrip({
  berths,
  picked,
  selecting,
  found,
  onBerth,
}: {
  berths: ManagerBerth[];
  picked: Set<string>;
  selecting: boolean;
  found: string | null;
  onBerth: (e: MouseEvent, b: ManagerBerth) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (berths.length === 0) return <p className="text-sm text-muted">Nessun posto in questo tratto.</p>;
  const cols = unitPositions(berths);
  const total = Math.max(...berths.map((b) => (cols.get(b.id) ?? 0) + 1));
  // Quante colonne stanno in una riga; finché non si conosce la larghezza, tutte.
  const perRow = width ? Math.max(1, Math.floor((width + GAP) / (CELL_MIN + GAP))) : total;
  const rows = Math.ceil(total / perRow);
  const inRow = Math.ceil(total / rows);
  const cell = width ? Math.min(CELL_MAX, Math.floor((width + GAP) / inRow) - GAP) : CELL_MIN;
  const chunks = Array.from({ length: rows }, (_, r) => {
    const from = r * inRow;
    return { from, list: berths.filter((b) => (cols.get(b.id) ?? 0) >= from && (cols.get(b.id) ?? 0) < from + inRow) };
  });

  return (
    <div ref={ref} className="space-y-3">
      {chunks.map(({ from, list }) => {
        const span = Math.max(...list.map((b) => (cols.get(b.id) ?? 0) - from + 1), 1);
        const sx = list.filter((b) => b.side === "sx");
        const dx = list.filter((b) => b.side === "dx");
        return (
          <div key={from}>
            {rows > 1 && (
              <p className="mb-1 text-xs font-medium text-muted">{[codeRange(sx), codeRange(dx)].filter(Boolean).join(" · ")}</p>
            )}
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${span}, ${cell}px)`, gridTemplateRows: "auto 0.5rem auto" }}>
              {list.map((b) => {
                const on = picked.has(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    data-berth={b.id}
                    onClick={(e) => onBerth(e, b)}
                    aria-pressed={selecting ? on : undefined}
                    title={`${b.code} · ${STATE_LABEL[b.state]}${b.occupant ? ` · ${b.occupant.boatName}` : ""}`}
                    style={{ gridColumn: (cols.get(b.id) ?? 0) - from + 1, gridRow: b.side === "sx" ? 1 : 3 }}
                    className={`relative flex h-10 min-w-0 items-center justify-center overflow-hidden rounded-md border px-0.5 text-[13px] font-semibold tabular-nums transition hover:-translate-y-px hover:shadow ${STATE_CELL[b.state]} ${
                      on ? "ring-2 ring-buoy ring-offset-1" : ""
                    } ${found === b.id ? "animate-pulse ring-2 ring-buoy ring-offset-2" : ""}`}
                  >
                    {b.code}
                  </button>
                );
              })}
              <div className="rounded-sm bg-line" style={{ gridColumn: `1 / ${span + 1}`, gridRow: 2 }} aria-hidden="true" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeleteConfirm({ pierId, name, count, onCancel }: { pierId: string; name: string; count: number; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim().toLocaleLowerCase("it") === name.trim().toLocaleLowerCase("it");
  return (
    <Form action={deletePier} className="space-y-2 rounded-md border border-bad/30 bg-bad-soft p-3 text-sm text-bad">
      <input type="hidden" name="pierId" value={pierId} />
      <p className="font-semibold">
        Eliminare «{name}»{count > 0 ? ` con i suoi ${count === 1 ? "posto" : `${count} posti`}` : ""}?
      </p>
      <p>Se un posto ha contratti il pontile non si può eliminare. Per confermare scrivi il nome del pontile.</p>
      <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} aria-label="Scrivi il nome del pontile per confermare" />
      <div className="flex flex-wrap items-center gap-2">
        <Submit variant="danger" disabled={!ok}>
          Elimina definitivamente
        </Submit>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Annulla
        </button>
        <FormMessage />
      </div>
    </Form>
  );
}
