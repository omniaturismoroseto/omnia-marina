"use client";

import { useState, useTransition } from "react";
import { ActionButton, Field, Form, FormMessage, SelectField, Submit } from "@/components/form";
import { addDays, formatDate, isValidISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { Quote } from "@/lib/pricing";
import { addSeasonPeriod, deletePriceList, deleteSeasonPeriod, duplicatePriceList, savePriceList, saveRates, simulateQuote } from "@/server/tariff-actions";

const VAT_OPTIONS = [22, 10, 5, 4, 0].map((r) => ({ value: String(r), label: `${r}%` }));

export function PriceListForm({ list, defaultYear }: { list?: { id: string; name: string; validFrom: string; validTo: string; vatRate: number }; defaultYear: number }) {
  return (
    <Form action={savePriceList} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {list && <input type="hidden" name="id" value={list.id} />}
      <Field name="name" label="Nome" defaultValue={list?.name ?? `Listino ${defaultYear}`} required wrapperClassName="lg:col-span-2" />
      <Field name="validFrom" label="Valido dal" type="date" defaultValue={list?.validFrom ?? `${defaultYear}-01-01`} required />
      <Field name="validTo" label="Valido fino al" type="date" defaultValue={list?.validTo ?? `${defaultYear}-12-31`} required />
      <SelectField name="vatRate" label="IVA inclusa nei prezzi" defaultValue={String(list?.vatRate ?? 22)} options={VAT_OPTIONS} />
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-5">
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
] as const;

export interface RateGridRow {
  categoryId: string;
  categoryName: string;
  size: string;
  values: Record<(typeof COLUMNS)[number][0], string>;
}

// Griglia tariffe: una riga per categoria, una colonna per periodo e stagione.
export function RatesGrid({ listId, rows, editable }: { listId: string; rows: RateGridRow[]; editable: boolean }) {
  const table = (
    <div className="overflow-x-auto">
      <table className="tbl min-w-[760px]">
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
          {rows.map((row) => (
            <tr key={row.categoryId}>
              <th scope="row" className="border-b border-line-soft px-3 py-2 text-left font-medium whitespace-nowrap">
                {row.categoryName}
                <span className="block text-xs font-normal text-muted">{row.size}</span>
              </th>
              {COLUMNS.map(([key, period, season]) => (
                <td key={key} className="num">
                  {editable ? (
                    <input
                      name={`${row.categoryId}:${key}`}
                      defaultValue={row.values[key]}
                      inputMode="decimal"
                      aria-label={`${row.categoryName}, ${period.toLowerCase()} ${season}`.trim()}
                      className="input ml-auto w-24 px-2 py-1 text-right tabular-nums"
                    />
                  ) : (
                    // In sola lettura l'importo si mostra con il separatore delle migliaia (1.900,00).
                    row.values[key].replace(/\B(?=(\d{3})+(?!\d))/g, ".") || "—"
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (!editable) return table;
  return (
    <Form action={saveRates}>
      <input type="hidden" name="listId" value={listId} />
      {table}
      <div className="flex items-center gap-3 border-t border-line-soft p-4">
        <Submit>Salva tariffe</Submit>
        <FormMessage />
        <span className="text-sm text-muted">Importi in euro, IVA inclusa.</span>
      </div>
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

export function Simulator({ listId, categories, today }: { listId: string; categories: { id: string; name: string }[]; today: string }) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [type, setType] = useState("transito");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 3));
  const [quote, setQuote] = useState<Quote | null | "none">(null);
  const [pending, startTransition] = useTransition();
  const valid = categoryId && isValidISODate(startDate) && isValidISODate(endDate) && endDate >= startDate;

  function calculate() {
    startTransition(async () => {
      const result = await simulateQuote({ listId, categoryId, type, startDate, endDate });
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
          </div>
        )}
      </div>
    </div>
  );
}
