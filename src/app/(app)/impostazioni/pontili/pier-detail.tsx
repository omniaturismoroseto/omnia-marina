"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { ActionButton, Form, FormMessage, SelectField, Submit } from "@/components/form";
import { Check, ChevronLeft, Ellipsis, Map as MapIcon, Pencil, Plus } from "@/components/icons";
import { STATE_LABEL } from "@/lib/berth-states";
import { compareCodes } from "@/lib/berth-codes";
import { moduleCodes, stripModules } from "@/lib/pier-strip";
import { deletePier, mergePierInto, movePier } from "@/server/settings-actions";
import { PierForm } from "../settings-forms";
import { AddBerthsPanel } from "./add-berths";
import { BulkCodesForm, BulkDeleteForm, BulkEditForm, BulkSectionForm, pickedSummary } from "./bulk-forms";
import { Drawer } from "./drawer";
import { STATE_CELL, STATE_ORDER, stateCounts } from "./states";
import { moduleKey, type ManagerBerth, type ManagerCategory, type ManagerPier, type ManagerUnit } from "./types";
import { ArrangeForm, DissolveSectionButton, ModuleNameForm, NumberingForm, RenameSectionForm, SplitAtForm, SplitSectionForm } from "./unit-tools";

type Bulk = "edit" | "codes" | "section" | "delete";
type UnitAction = "arrange" | "numbers" | "divide" | "rename" | "split" | "dissolve";

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
  moduleNames,
  mapOpen,
  mapUnitId,
  onShowMap,
  onPickedChange,
  mapPickedIds = [],
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
  /** Nomi dei moduli, per moduleKey(pontile, tratto, modulo). */
  moduleNames: Record<string, string>;
  /** Mappa aperta sotto la scheda, sul pontile intero (mapUnitId null) o su un tratto. */
  mapOpen: boolean;
  mapUnitId: string | null;
  /** Apre o chiude la mappa sotto la scheda; manca senza pianta. */
  onShowMap?: (unitId: string | null) => void;
  /** I posti scelti con «Scegli più posti», per evidenziarli sulla mappa aperta sotto. */
  onPickedChange?: (ids: string[]) => void;
  /** Posti scelti sulla mappa aperta sotto: nella striscia sono contornati in arancio, come sulla mappa. */
  mapPickedIds?: string[];
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
  // Codici dei posti di questo pontile scelti sulla mappa aperta sotto.
  const mapCodes = all.filter((b) => mapPickedIds.includes(b.id)).map((b) => b.code);
  const c = stateCounts(all);
  const multi = units.some((u) => u.sectionId);
  const byCategory = categories.map((cat) => ({ cat, n: all.filter((b) => b.categoryId === cat.id).length })).filter((x) => x.n > 0);
  const without = all.filter((b) => !b.categoryId || !categories.some((cat) => cat.id === b.categoryId)).length;
  const codes = useMemo(() => [...existingCodes], [existingCodes]);

  // I posti scelti si vedono evidenziati anche sulla mappa aperta sotto la scheda.
  useEffect(() => {
    onPickedChange?.([...picked]);
  }, [picked, onPickedChange]);

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
          {onShowMap ? (
            // Sotto la scheda si apre la mappa inquadrata sul pontile, dove si modificano i posti.
            <button type="button" className={linkBtn} aria-pressed={mapOpen && mapUnitId === null} onClick={() => onShowMap(null)}>
              <MapIcon size={16} aria-hidden="true" /> {mapOpen && mapUnitId === null ? "Chiudi la mappa" : "Mostra sulla mappa"}
            </button>
          ) : (
            <Link href="/mappa" className={linkBtn}>
              <MapIcon size={16} aria-hidden="true" /> Vedi sulla mappa
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
              <button type="button" className="btn btn-primary" onClick={endSelection}>
                <Check size={16} aria-hidden="true" /> Fine selezione
              </button>
            ) : (
              // Ben visibile: è il modo per modificare, rinominare o eliminare più posti insieme.
              <button type="button" className="btn border-sea bg-sea-soft text-sea-dark hover:bg-white" onClick={() => setSelecting(true)}>
                <Check size={16} aria-hidden="true" /> Scegli più posti
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

        {all.length === 0 && !add && <p className="text-sm text-muted">Questo pontile non ha ancora posti: usa «Aggiungi posti».</p>}

        {mapCodes.length > 0 && (
          <p className="flex flex-wrap items-center gap-2 rounded-md bg-[#fbe9e2] px-3 py-2 text-sm text-ink" aria-live="polite">
            <i className="inline-block h-3 w-4 rounded-sm border-2 border-[#d4502a]" aria-hidden="true" />
            Scelti sulla mappa:{" "}
            <b className="tabular-nums">
              {mapCodes.length === 1 ? `il posto ${mapCodes[0]}` : `${mapCodes.length} posti (${mapCodes.length > 8 ? `${mapCodes[0]} … ${mapCodes[mapCodes.length - 1]}` : mapCodes.join(", ")})`}
            </b>
          </p>
        )}

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
                <span className="flex flex-1 flex-wrap items-center justify-end gap-2">
                  {onShowMap && multi && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      aria-pressed={mapOpen && mapUnitId === (u.sectionId ?? pier.id)}
                      onClick={() => onShowMap(u.sectionId ?? pier.id)}
                    >
                      <MapIcon size={15} aria-hidden="true" /> Sulla mappa
                    </button>
                  )}
                  {/* Tutti i comandi del tratto in un menu solo, per non riempire la scheda di collegamenti. */}
                  <UnitMenu
                    label={u.sectionId ? "Modifica il tratto" : "Modifica i posti"}
                    items={[
                      u.berths.length > 0 && { label: "Disposizione dei posti", onClick: () => toggle("arrange") },
                      u.berths.length > 1 && { label: "Numerazione", onClick: () => toggle("numbers") },
                      u.berths.length > 1 && { label: "Dividi in due tratti", onClick: () => toggle("divide") },
                      multi && { label: "Aggiungi posti qui", onClick: () => setAdd({ sectionId: u.sectionId }) },
                      u.sectionId && { label: "Rinomina il tratto", onClick: () => toggle("rename") },
                      u.sectionId && { label: "Rendi pontile a sé", onClick: () => toggle("split") },
                      u.sectionId && { label: "Togli il tratto", onClick: () => toggle("dissolve"), danger: true },
                    ]}
                  />
                </span>
              </div>
              {open && (
                <div className="mb-3 rounded-md border border-line-soft bg-paper p-3">
                  {open === "arrange" && <ArrangeForm pierId={pier.id} sectionId={u.sectionId} hasPlan={hasPlan} />}
                  {open === "numbers" && (
                    <NumberingForm
                      pierId={pier.id}
                      hasPlan={hasPlan}
                      scopes={[
                        { label: u.sectionId ? `Tutto il ${u.title.toLowerCase()}` : "Tutti i posti", berthIds: u.berths.map((b) => b.id) },
                        // Stessi nomi della striscia qui sotto: «Modulo N» conta i moduli sulla pianta nell'ordine dei codici.
                        ...stripModules(u.berths)
                          .filter((g) => g.module !== null)
                          .map((g, i) => ({
                            label: moduleNames[moduleKey(pier.id, u.sectionId, g.module!)] || `Modulo ${i + 1}`,
                            berthIds: g.berths.map((b) => b.id),
                          }))
                          .filter((sc) => sc.berthIds.length > 1 && sc.berthIds.length < u.berths.length),
                      ]}
                    />
                  )}
                  {open === "divide" && (
                    <SplitAtForm
                      pierId={pier.id}
                      sectionId={u.sectionId}
                      berths={[...u.berths].sort((a, b) => compareCodes(a.code, b.code))}
                      first={u.label || "1"}
                      second={u.label ? `${u.label} 2` : "2"}
                    />
                  )}
                  {open === "rename" && u.sectionId && <RenameSectionForm sectionId={u.sectionId} label={u.label} onDone={() => setUnitAction(null)} />}
                  {open === "dissolve" && u.sectionId && (
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
                      <span>I posti restano nel pontile, ma sulla mappa non si spostano più da soli.</span>
                      <DissolveSectionButton sectionId={u.sectionId} label={u.label} />
                    </div>
                  )}
                  {open === "split" && u.sectionId && <SplitSectionForm sectionId={u.sectionId} code={u.label.slice(0, 4).toUpperCase()} name={`${pier.name} ${u.label}`} />}
                </div>
              )}
              <BerthStrip
                berths={u.berths}
                picked={picked}
                selecting={selecting}
                found={found}
                onBerth={onBerth}
                mapPicked={mapPickedIds}
                pierId={pier.id}
                sectionId={u.sectionId}
                moduleNames={moduleNames}
              />
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

/** Menu dei comandi di un tratto (o dei posti di un pontile senza tratti): un pulsante, la lista sotto; si chiude toccando fuori. */
function UnitMenu({ label, items }: { label: string; items: (false | null | "" | undefined | { label: string; onClick: () => void; danger?: boolean })[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: globalThis.MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const list = items.filter((x): x is { label: string; onClick: () => void; danger?: boolean } => Boolean(x));
  if (list.length === 0) return null;
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-secondary btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label} <Ellipsis size={16} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-30 mt-1.5 w-60 rounded-lg border border-line bg-card p-1 shadow-xl">
          {list.map((item) => (
            <MenuItem
              key={item.label}
              danger={item.danger}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </MenuItem>
          ))}
        </div>
      )}
    </div>
  );
}

// Larghezza delle celle dei posti (px): si allargano fino a CELL_MAX per riempire la riga; sotto CELL_MIN il modulo scorre di lato.
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
/**
 * Posti come sono in porto, modulo per modulo (le parti staccate riconosciute sulla pianta): sopra il lato sinistro,
 * sotto il destro, dalla radice alla testata. Le celle si allargano per riempire la riga; se il modulo è più lungo dello
 * schermo va a capo a blocchi (niente barra di scorrimento), e ogni blocco tiene insieme i due lati, uno di fronte all'altro.
 */
function BerthStrip({
  berths,
  picked,
  selecting,
  found,
  onBerth,
  mapPicked = [],
  pierId,
  sectionId,
  moduleNames,
}: {
  berths: ManagerBerth[];
  picked: Set<string>;
  selecting: boolean;
  found: string | null;
  onBerth: (e: MouseEvent, b: ManagerBerth) => void;
  mapPicked?: string[];
  pierId: string;
  sectionId: string | null;
  moduleNames: Record<string, string>;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [renaming, setRenaming] = useState<number | null>(null);
  if (berths.length === 0) return <p className="text-sm text-muted">Nessun posto in questo tratto.</p>;
  const groups = stripModules(berths);
  const many = groups.length > 1;
  let n = 0;

  return (
    <div ref={ref} className="space-y-4">
      {groups.map((g) => {
        // Colonne per riga: quante ne stanno larghe almeno CELL_MIN; oltre si va a capo. Le celle riempiono la riga (al massimo CELL_MAX).
        const perRow = width ? Math.max(1, Math.floor((width + GAP) / (CELL_MIN + GAP))) : g.span;
        const cols = Math.min(g.span, perRow);
        const cell = width ? Math.min(CELL_MAX, Math.floor((width + GAP) / cols) - GAP) : CELL_MIN;
        const blocks = Array.from({ length: Math.ceil(g.span / cols) }, (_, i) => i);
        const sides = new Set(g.berths.map((b) => b.side));
        const index = g.module === null ? 0 : ++n;
        const named = g.module === null ? "" : (moduleNames[moduleKey(pierId, sectionId, g.module)] ?? "");
        const label = g.module === null ? "Non ancora sulla pianta" : named || `Modulo ${index}`;
        return (
          <div key={g.module ?? "fuori"} className={many ? "rounded-md border border-line-soft bg-paper/60 p-2" : undefined}>
            {many && (
              <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted">
                <span>
                  <span className="font-semibold text-ink">{label}</span> · {g.berths.length} {g.berths.length === 1 ? "posto" : "posti"} ·{" "}
                  {moduleCodes(g.berths)}
                </span>
                {g.module !== null && renaming !== g.module && (
                  <button type="button" className="link inline-flex items-center gap-1" onClick={() => setRenaming(g.module)}>
                    <Pencil size={12} aria-hidden="true" /> {named ? "Rinomina" : "Dai un nome"}
                  </button>
                )}
              </div>
            )}
            {many && g.module !== null && renaming === g.module && (
              <div className="mb-2 rounded-md border border-line-soft bg-card p-2">
                <ModuleNameForm pierId={pierId} module={g.module} berthIds={g.berths.map((b) => b.id)} name={named} onDone={() => setRenaming(null)} />
              </div>
            )}
            <div className="space-y-2">
              {blocks.map((block) => (
              <div
                key={block}
                className="grid gap-1"
                style={{
                  gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
                  gridTemplateRows: sides.size === 2 ? "auto auto" : "auto",
                }}
              >
                {g.berths.map((b) => {
                  const column = g.columns.get(b.id)!;
                  if (Math.floor(column / cols) !== block) return null;
                  const on = picked.has(b.id);
                  const row = b.side === "dx" && sides.size === 2 ? 2 : 1;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      data-berth={b.id}
                      onClick={(e) => onBerth(e, b)}
                      aria-pressed={selecting ? on : undefined}
                      title={`${b.code} · ${STATE_LABEL[b.state]}${b.occupant ? ` · ${b.occupant.boatName}` : ""}`}
                      style={{ gridColumn: (column % cols) + 1, gridRow: row }}
                      className={`relative flex h-10 min-w-0 items-center justify-center overflow-hidden rounded-md border px-0.5 text-[13px] font-semibold tabular-nums transition hover:-translate-y-px hover:shadow ${STATE_CELL[b.state]} ${
                        on ? "ring-2 ring-buoy ring-offset-1" : mapPicked.includes(b.id) ? "ring-[3px] ring-[#d4502a] ring-offset-1" : ""
                      } ${found === b.id ? "animate-pulse ring-2 ring-buoy ring-offset-2" : ""}`}
                    >
                      {b.code}
                    </button>
                  );
                })}
              </div>
              ))}
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
