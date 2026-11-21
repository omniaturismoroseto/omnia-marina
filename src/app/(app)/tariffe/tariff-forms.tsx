"use client";

import { useState, useTransition } from "react";
import { ActionButton, Field, Form, FormMessage, SelectField, Submit } from "@/components/form";
import { addDays, formatDate, isValidISODate } from "@/lib/dates";
import { SPACE_ITEM_KINDS } from "@/lib/contract-items";
import { formatMoney, moneyInput, parseMoney } from "@/lib/format";
import { CONTRACT_ITEM_LABEL } from "@/lib/labels";
import { annualTotal, type Quote } from "@/lib/pricing";
import {
  addPriceListExtra,
  addSeasonPeriod,
  deletePriceList,
  deletePriceListExtra,
  copyPierRates,
  deleteSeasonPeriod,
  duplicatePriceList,
  loadOfficialPriceListAction,
  saveBaseRatePiers,
  savePriceList,
  setPierBaseRate,
  updatePriceListExtra,
  saveRates,
  simulateQuote,
} from "@/server/tariff-actions";

const VAT_OPTIONS = [22, 10, 5, 4, 0].map((r) => ({ value: String(r), label: `${r}%` }));

export function PriceListForm({
  list,
  defaultYear,
}: {
  list?: { id: string; name: string; validFrom: string; validTo: string; vatRate: number; vatIncluded: boolean };
  defaultYear: number;
}) {
  return (
    <Form action={savePriceList} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {list && <input type="hidden" name="id" value={list.id} />}
      <Field name="name" label="Nome" defaultValue={list?.name ?? `Listino ${defaultYear}`} required wrapperClassName="lg:col-span-2" />
      <Field name="validFrom" label="Valido dal" type="date" defaultValue={list?.validFrom ?? `${defaultYear}-01-01`} required />
      <Field name="validTo" label="Valido fino al" type="date" defaultValue={list?.validTo ?? `${defaultYear}-12-31`} required />
      <SelectField name="vatRate" label="Aliquota IVA" defaultValue={String(list?.vatRate ?? 22)} options={VAT_OPTIONS} />
      <SelectField
        name="vatMode"
        label="I prezzi scritti sono"
        defaultValue={list && list.vatIncluded ? "inclusa" : "esclusa"}
        options={[
          { value: "esclusa", label: "Senza IVA (si aggiunge)" },
          { value: "inclusa", label: "IVA inclusa" },
        ]}
        hint="Vale per tariffe e servizi del listino. Cambiarlo non modifica gli importi già scritti."
        wrapperClassName="sm:col-span-2 lg:col-span-2"
      />
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-7">
        <Submit variant={list ? "secondary" : "primary"} size="sm">
          {list ? "Salva" : "Crea listino"}
        </Submit>
        <FormMessage />
      </div>
    </Form>
  );
}

export function ListActions({ listId }: { listId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton action={duplicatePriceList} fields={{ listId }} size="sm">
        Copia sull&apos;anno successivo
      </ActionButton>
      <ActionButton action={deletePriceList} fields={{ listId }} size="sm" variant="danger" confirm="Eliminare questo listino con tutte le sue tariffe? I contratti già creati non cambiano.">
        Elimina listino
      </ActionButton>
    </div>
  );
}

const COLUMNS = [
  ["dailyLow", "Giorno", "bassa"],
  ["dailyMid", "Giorno", "media"],
  ["dailyHigh", "Giorno", "alta"],
  ["monthlyLow", "Mese", "bassa"],
  ["monthlyMid", "Mese", "media"],
  ["monthlyHigh", "Mese", "alta"],
  ["annual", "Anno", ""],
  ["seasonal", "Stagionale", ""],
  ["waste", "Rifiuti", ""],
  ["service", "Condominio", ""],
] as const;

type RateKey = (typeof COLUMNS)[number][0];

export interface RateGridRow {
  categoryId: string;
  categoryName: string;
  size: string;
  values: Record<RateKey, string>;
  /** Solo nei pontili: gli importi della tariffa base, mostrati nelle caselle vuote. */
  fallback?: Record<RateKey, string>;
}

// In sola lettura l'importo si mostra con il separatore delle migliaia (1.900,00).
const readable = (v: string) => v.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Griglia tariffe di un pontile (o della tariffa base): una riga per categoria, una colonna per periodo e stagione,
 * e in fondo IVA e totale di un anno (annuale + rifiuti + condominio), ricalcolati mentre si scrive.
 */
export function RatesGrid({
  listId,
  pierId,
  rows,
  editable,
  vatRate,
  vatIncluded,
}: {
  listId: string;
  pierId: string;
  rows: RateGridRow[];
  editable: boolean;
  vatRate: number;
  vatIncluded: boolean;
}) {
  const [values, setValues] = useState(() => Object.fromEntries(rows.map((r) => [r.categoryId, r.values])) as Record<string, Record<RateKey, string>>);
  // Importo valido della casella: quello scritto o, nei pontili, quello della tariffa base.
  const cents = (row: RateGridRow, key: RateKey) => parseMoney(values[row.categoryId]?.[key] || row.fallback?.[key] || "") ?? 0;
  const yearOf = (row: RateGridRow) => annualTotal({ annual: cents(row, "annual"), waste: cents(row, "waste"), service: cents(row, "service") }, vatRate, vatIncluded);
  const vatLabel = vatIncluded ? `${vatRate}% inclusa` : `${vatRate}% in più`;

  const table = (
    <div className="overflow-x-auto">
      <table className="tbl min-w-[1180px]">
        <thead>
          <tr>
            <th rowSpan={2}>Categoria</th>
            <th colSpan={3} className="border-l border-line text-center">
              Tariffa giornaliera
            </th>
            <th colSpan={3} className="border-l border-line text-center">
              Tariffa mensile
            </th>
            <th rowSpan={2} className="num border-l border-line">
              Annuale
            </th>
            <th rowSpan={2} className="num border-l border-line">
              Stagionale
              <span className="block text-[11px] font-normal normal-case text-muted">canone fisso</span>
            </th>
            <th rowSpan={2} className="num border-l border-line">
              Rifiuti
              <span className="block text-[11px] font-normal normal-case text-muted">voce degli annuali</span>
            </th>
            <th rowSpan={2} className="num border-l border-line">
              Condominio
              <span className="block text-[11px] font-normal normal-case text-muted">voce degli annuali</span>
            </th>
            <th rowSpan={2} className="num border-l border-line">
              IVA
              <span className="block text-[11px] font-normal normal-case text-muted">{vatLabel}</span>
            </th>
            <th rowSpan={2} className="num border-l border-line">
              Totale annuo
              <span className="block text-[11px] font-normal normal-case text-muted">con rifiuti, condominio e IVA</span>
            </th>
          </tr>
          <tr>
            {COLUMNS.slice(0, 6).map(([key, , season], i) => (
              <th key={key} className={`num ${i % 3 === 0 ? "border-l border-line" : ""}`}>
                {season}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const year = yearOf(row);
            return (
              <tr key={row.categoryId}>
                <th scope="row" className="border-b border-line-soft px-3 py-2 text-left font-medium whitespace-nowrap">
                  {row.categoryName}
                  <span className="block text-xs font-normal text-muted">{row.size}</span>
                </th>
                {COLUMNS.map(([key, period, season]) => (
                  <td key={key} className={editable ? "num px-1! py-1.5!" : "num"}>
                    {editable ? (
                      <input
                        name={`${row.categoryId}:${key}`}
                        value={values[row.categoryId]?.[key] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [row.categoryId]: { ...v[row.categoryId], [key]: e.target.value } }))}
                        placeholder={row.fallback?.[key] || undefined}
                        inputMode="decimal"
                        aria-label={`${row.categoryName}, ${period.toLowerCase()} ${season}`.trim()}
                        className="input ml-auto w-[5.25rem] px-2 py-1 text-right tabular-nums placeholder:text-faint"
                      />
                    ) : row.values[key] ? (
                      readable(row.values[key])
                    ) : row.fallback?.[key] ? (
                      <span className="text-faint" title="Come la tariffa base">
                        {readable(row.fallback[key])}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                ))}
                <td className="num border-l border-line text-muted">{year.totalCents ? formatMoney(year.vatCents) : "—"}</td>
                <td className="num font-semibold">{year.totalCents ? formatMoney(year.totalCents) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (!editable) return table;
  return (
    <Form action={saveRates}>
      <input type="hidden" name="listId" value={listId} />
      <input type="hidden" name="pierId" value={pierId} />
      {table}
      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft p-4">
        <Submit>Salva tariffe</Submit>
        <FormMessage />
        <span className="text-sm text-muted">
          Importi in euro, {vatIncluded ? "IVA inclusa" : "senza IVA"}.{pierId ? " Le caselle vuote usano la tariffa base, mostrata in grigio." : ""}
        </span>
      </div>
    </Form>
  );
}

// ───────────────────────── Tariffa base e pontili ─────────────────────────

// I pontili a cui si applica la tariffa base: da nessuno (spenta) a tutti. Gli altri usano i propri prezzi.
export function BaseRatePiersForm({ piers }: { piers: { id: string; name: string; baseRate: boolean }[] }) {
  const [chosen, setChosen] = useState(() => new Set(piers.filter((p) => p.baseRate).map((p) => p.id)));
  const all = chosen.size === piers.length;
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setChosen(next);
  };
  return (
    <Form action={saveBaseRatePiers} className="space-y-2">
      <p className="text-sm text-muted">
        Applica la tariffa base a questi pontili; gli altri usano i propri prezzi (nella loro scheda), e dove una casella è vuota vale comunque la tariffa
        base.
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" checked={all} onChange={(e) => setChosen(e.target.checked ? new Set(piers.map((p) => p.id)) : new Set())} />
          Tutti
        </label>
        {piers.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="base" value={p.id} checked={chosen.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
            {p.name}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Submit variant="secondary" size="sm">
          Salva
        </Submit>
        <FormMessage />
        {chosen.size === 0 && <span className="text-sm text-muted">Tariffa base spenta: ogni pontile usa i suoi prezzi.</span>}
      </div>
    </Form>
  );
}

export function PierBaseRateButton({ pierId, name, baseRate }: { pierId: string; name: string; baseRate: boolean }) {
  return (
    <ActionButton action={setPierBaseRate} fields={{ pierId, baseRate: baseRate ? "0" : "1" }} size="sm" variant={baseRate ? "primary" : "secondary"}>
      {baseRate ? `Usa i prezzi di ${name}` : "Torna alla tariffa base"}
    </ActionButton>
  );
}

// Copia nella griglia del pontile i prezzi della tariffa base o di un altro pontile, per il listino aperto.
export function CopyPierRatesForm({ listId, pierId, sources }: { listId: string; pierId: string; sources: { id: string; name: string }[] }) {
  return (
    <Form
      action={copyPierRates}
      className="flex flex-wrap items-end gap-2"
      confirm="Sostituire i prezzi di questo pontile, in questo listino, con quelli scelti?"
    >
      <input type="hidden" name="listId" value={listId} />
      <input type="hidden" name="pierId" value={pierId} />
      <SelectField
        name="from"
        label="Copia i prezzi da"
        defaultValue=""
        options={[{ value: "", label: "Tariffa base" }, ...sources.map((p) => ({ value: p.id, label: p.name }))]}
        wrapperClassName="min-w-48"
      />
      <Submit variant="secondary" size="sm">
        Copia
      </Submit>
      <FormMessage />
    </Form>
  );
}

export function SeasonPeriodForm({ listId, validFrom }: { listId: string; validFrom: string }) {
  return (
    <Form action={addSeasonPeriod} resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <input type="hidden" name="listId" value={listId} />
      <SelectField
        name="season"
        label="Stagione"
        defaultValue="alta"
        options={[
          { value: "alta", label: "Alta" },
          { value: "media", label: "Media" },
        ]}
      />
      <Field name="startDate" label="Dal" type="date" defaultValue={validFrom} required />
      <Field name="endDate" label="Al" type="date" defaultValue={validFrom} required />
      <div className="flex items-end">
        <Submit variant="secondary">Aggiungi periodo</Submit>
      </div>
      <div className="sm:col-span-4">
        <FormMessage />
      </div>
    </Form>
  );
}

export function DeletePeriodButton({ periodId }: { periodId: string }) {
  return (
    <ActionButton action={deleteSeasonPeriod} fields={{ periodId }} variant="ghost" size="sm">
      Rimuovi
    </ActionButton>
  );
}

export function Simulator({
  listId,
  categories,
  piers,
  today,
}: {
  listId: string;
  categories: { id: string; name: string }[];
  piers: { id: string; name: string }[];
  today: string;
}) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [pierId, setPierId] = useState("");
  const [type, setType] = useState("transito");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 3));
  const [quote, setQuote] = useState<(Quote & { wasteCents: number; serviceCents: number }) | null | "none">(null);
  const [pending, startTransition] = useTransition();
  const valid = categoryId && isValidISODate(startDate) && isValidISODate(endDate) && endDate >= startDate;

  function calculate() {
    startTransition(async () => {
      const result = await simulateQuote({ listId, categoryId, pierId, type, startDate, endDate });
      setQuote(result ?? "none");
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="sim-cat">
            Categoria
          </label>
          <select id="sim-cat" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {piers.length > 0 && (
          <div className="sm:col-span-2">
            <label className="label" htmlFor="sim-pier">
              Pontile
            </label>
            <select id="sim-pier" className="input" value={pierId} onChange={(e) => setPierId(e.target.value)}>
              <option value="">Tariffa base</option>
              {piers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="sim-type">
            Tipo
          </label>
          <select id="sim-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="transito">Transito</option>
            <option value="mensile">Mensile</option>
            <option value="stagionale">Stagionale</option>
            <option value="annuale">Annuale</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sim-from">
            Dal
          </label>
          <input id="sim-from" type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="sim-to">
            Al
          </label>
          <input id="sim-to" type="date" className="input" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <button type="button" className="btn btn-secondary" disabled={!valid || pending} onClick={calculate}>
        {pending ? "Calcolo…" : "Calcola"}
      </button>
      <div aria-live="polite">
        {quote === "none" && <p className="text-sm text-warn">Nessuna tariffa salvata per questa categoria.</p>}
        {quote && quote !== "none" && (
          <div className="rounded-md bg-paper p-3 text-sm">
            <ul className="space-y-1">
              {quote.lines.map((l) => (
                <li key={l.label} className="flex justify-between gap-3">
                  <span>
                    {l.quantity} × {l.label.charAt(0).toLowerCase() + l.label.slice(1)} <span className="text-muted">({formatMoney(l.unitCents)})</span>
                  </span>
                  <span className="tabular-nums">{formatMoney(l.amountCents)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
              <span>
                {formatDate(startDate)} – {formatDate(endDate)}
              </span>
              <span className="tabular-nums">{formatMoney(quote.totalCents)}</span>
            </p>
            {(quote.wasteCents > 0 || quote.serviceCents > 0) && (
              <p className="mt-1 text-xs text-muted">
                Più{" "}
                {[quote.wasteCents > 0 && `la quota rifiuti di ${formatMoney(quote.wasteCents)}`, quote.serviceCents > 0 && `il condominio di ${formatMoney(quote.serviceCents)}`]
                  .filter(Boolean)
                  .join(" e ")}
                , voci a parte del contratto.
              </p>
            )}
            <p className="mt-1 text-xs text-muted">Importi IVA inclusa, come li propone il contratto.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export interface ExtraRow {
  id: string;
  name: string;
  amountCents: number;
  vatRate: number;
  itemKind: keyof typeof CONTRACT_ITEM_LABEL | null;
}

const EXTRA_VAT_OPTIONS = [...VAT_OPTIONS.slice(0, -1), { value: "0", label: "Senza IVA (cauzione)" }];

// Campi comuni al modulo di aggiunta e a quello di modifica.
function ExtraFields({ extra, vatIncluded }: { extra?: ExtraRow; vatIncluded: boolean }) {
  return (
    <>
      <Field name="name" label="Servizio" placeholder="Es. Posto auto coperto" defaultValue={extra?.name} required />
      <Field name="amount" label={vatIncluded ? "Importo (IVA inclusa)" : "Importo (senza IVA)"} inputMode="decimal" placeholder="0,00" defaultValue={extra ? moneyInput(extra.amountCents) : undefined} required />
      <SelectField name="vatRate" label="IVA" defaultValue={String(extra?.vatRate ?? 22)} options={EXTRA_VAT_OPTIONS} />
      <SelectField
        name="itemKind"
        label="Nel contratto"
        defaultValue={extra?.itemKind ?? ""}
        placeholder="Servizio, con il nome scritto qui"
        options={SPACE_ITEM_KINDS.map((k) => ({ value: k, label: `${CONTRACT_ITEM_LABEL[k]}, con periodo` }))}
        hint="Di solito va lasciato così: nel contratto compare il nome del servizio. Scegli un posto auto, il carrello o lo spazio a terra solo se serve indicare il periodo (dal… al…) e il numero del posto."
      />
    </>
  );
}

function ExtraItem({ extra, editable, vatIncluded }: { extra: ExtraRow; editable: boolean; vatIncluded: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span>
          {extra.name}
          <span className="block text-xs text-muted">
            {extra.vatRate === 0
              ? "senza IVA"
              : vatIncluded
                ? `IVA ${extra.vatRate}% inclusa`
                : `più IVA ${extra.vatRate}%: ${formatMoney(Math.round((extra.amountCents * (100 + extra.vatRate)) / 100))}`}
            {extra.itemKind && ` · nel contratto come «${CONTRACT_ITEM_LABEL[extra.itemKind].toLowerCase()}», con periodo`}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <span className="mr-1 font-medium tabular-nums">{formatMoney(extra.amountCents)}</span>
          {editable && !editing && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                Modifica
              </button>
              <ActionButton action={deletePriceListExtra} fields={{ extraId: extra.id }} variant="ghost" size="sm" confirm={`Eliminare «${extra.name}» dal listino?`}>
                Elimina
              </ActionButton>
            </>
          )}
        </span>
      </div>
      {editing && (
        <Form action={updatePriceListExtra} className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-line-soft bg-paper p-3 sm:grid-cols-2">
          <input type="hidden" name="extraId" value={extra.id} />
          <ExtraFields extra={extra} vatIncluded={vatIncluded} />
          <div className="flex items-center gap-2 sm:col-span-2">
            <Submit variant="secondary" size="sm">
              Salva
            </Submit>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Chiudi
            </button>
            <FormMessage />
          </div>
        </Form>
      )}
    </li>
  );
}

// Servizi e cauzioni a prezzo fisso: si propongono quando si crea un addebito.
export function PriceListExtras({ listId, extras, editable, vatIncluded }: { listId: string; extras: ExtraRow[]; editable: boolean; vatIncluded: boolean }) {
  return (
    <div className="space-y-4">
      {extras.length === 0 ? (
        <p className="text-sm text-muted">Nessun servizio a prezzo fisso in questo listino.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {extras.map((e) => (
            // La chiave cambia con i valori: dopo un salvataggio la riga si richiude da sola.
            <ExtraItem key={`${e.id}:${e.name}:${e.amountCents}:${e.vatRate}:${e.itemKind ?? ""}`} extra={e} editable={editable} vatIncluded={vatIncluded} />
          ))}
        </ul>
      )}
      {editable && (
        <Form action={addPriceListExtra} resetOnSuccess className="grid grid-cols-1 gap-3 border-t border-line-soft pt-4 sm:grid-cols-2">
          <input type="hidden" name="listId" value={listId} />
          <ExtraFields vatIncluded={vatIncluded} />
          <div className="flex items-center gap-3 sm:col-span-2">
            <Submit variant="secondary">Aggiungi</Submit>
            <FormMessage />
          </div>
        </Form>
      )}
    </div>
  );
}

export function LoadOfficialListButton({ hasList }: { hasList: boolean }) {
  return (
    <ActionButton
      action={loadOfficialPriceListAction}
      fields={{}}
      variant={hasList ? "secondary" : "primary"}
      size="sm"
      confirm={
        hasList
          ? "Riscrivere le tariffe delle categorie del listino ufficiale nel Listino 2026? Le altre categorie e i posti barca non cambiano."
          : "Creare il Listino 2026 con le categorie e le tariffe ufficiali? Le categorie esistenti e i posti barca non cambiano."
      }
    >
      {hasList ? "Ricarica il listino ufficiale 2026" : "Carica il listino ufficiale 2026"}
    </ActionButton>
  );
}
