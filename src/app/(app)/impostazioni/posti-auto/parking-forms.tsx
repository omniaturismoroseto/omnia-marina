"use client";

import { useState } from "react";
import { ActionButton, CheckboxField, Field, Form, FormMessage, SelectField, Submit } from "@/components/form";
import { metersInput } from "@/lib/format";
import { createParkingSpaces, deleteParkingSpace, updateParkingSpace } from "@/server/parking-actions";
import { Drawer } from "../pontili/drawer";

export interface ParkingRow {
  id: string;
  code: string;
  covered: boolean;
  lengthCm: number;
  widthCm: number;
  active: boolean;
  notes: string | null;
  onPlan: boolean;
  /** In un contratto (anche concluso): non si elimina. */
  used: boolean;
  /** Chi lo ha oggi. */
  today: string | null;
}

/** Nuovi posti auto in blocco: sigla, dal numero al numero, coperti o scoperti, misure. */
export function CreateParkingForm({ nextNumber }: { nextNumber: number }) {
  return (
    <Form action={createParkingSpaces} className="grid grid-cols-2 gap-3 sm:grid-cols-6" resetOnSuccess>
      <Field name="prefix" label="Sigla" defaultValue="P" maxLength={6} wrapperClassName="sm:col-span-1" />
      <Field name="from" label="Dal numero" defaultValue={String(nextNumber)} inputMode="numeric" required wrapperClassName="sm:col-span-1" />
      <Field name="to" label="Al numero" defaultValue={String(nextNumber + 9)} inputMode="numeric" required wrapperClassName="sm:col-span-1" />
      <SelectField
        name="covered"
        label="Tipo"
        defaultValue="scoperto"
        wrapperClassName="sm:col-span-1"
        options={[
          { value: "scoperto", label: "Scoperti" },
          { value: "coperto", label: "Coperti" },
        ]}
      />
      <Field name="lengthCm" label="Lunghezza (m)" defaultValue="5,00" inputMode="decimal" required wrapperClassName="sm:col-span-1" />
      <Field name="widthCm" label="Larghezza (m)" defaultValue="2,50" inputMode="decimal" required wrapperClassName="sm:col-span-1" />
      <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-6">
        <Submit>Crea i posti auto</Submit>
        <FormMessage />
      </div>
    </Form>
  );
}

/** Elenco dei posti auto: tipo, stato, chi lo ha oggi; toccando un posto si modifica. */
export function ParkingList({ rows }: { rows: ParkingRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;
  if (rows.length === 0) return <p className="text-sm text-muted">Ancora nessun posto auto: creali qui sopra.</p>;
  return (
    <>
      <ul className="flex flex-wrap gap-1.5" aria-label="Posti auto">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setOpenId(r.id)}
              title={`${r.covered ? "Coperto" : "Scoperto"}${r.today ? ` · oggi: ${r.today}` : ""}${r.active ? "" : " · fuori servizio"}${r.onPlan ? "" : " · non sulla mappa"}`}
              className={`flex h-10 min-w-14 items-center justify-center rounded-md border px-2 text-[13px] font-semibold tabular-nums ${
                !r.active
                  ? "border-line bg-line-soft text-faint line-through"
                  : r.today
                    ? "border-[#4f5f6f] bg-[#4f5f6f] text-white"
                    : "border-[#4f5f6f]/50 bg-[#eef1f4] text-ink"
              } ${r.onPlan ? "" : "border-dashed"}`}
            >
              {r.code}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <i className="mr-1 inline-block h-2.5 w-3 rounded-sm border border-[#4f5f6f]/50 bg-[#eef1f4] align-middle" />
          libero oggi
        </span>
        <span>
          <i className="mr-1 inline-block h-2.5 w-3 rounded-sm bg-[#4f5f6f] align-middle" />
          assegnato oggi
        </span>
        <span>bordo tratteggiato = non ancora sulla mappa</span>
      </p>
      {open && (
        <Drawer title={`Posto auto ${open.code}`} subtitle={open.today ? `Oggi: ${open.today}` : open.covered ? "Coperto" : "Scoperto"} onClose={() => setOpenId(null)}>
          <Form action={updateParkingSpace} className="space-y-4" key={open.id}>
            <input type="hidden" name="id" value={open.id} />
            <div className="grid grid-cols-2 gap-3">
              <Field name="code" label="Codice" defaultValue={open.code} required />
              <SelectField
                name="covered"
                label="Tipo"
                defaultValue={open.covered ? "coperto" : "scoperto"}
                options={[
                  { value: "scoperto", label: "Scoperto" },
                  { value: "coperto", label: "Coperto" },
                ]}
              />
              <Field name="lengthCm" label="Lunghezza (m)" defaultValue={metersInput(open.lengthCm)} inputMode="decimal" required />
              <Field name="widthCm" label="Larghezza (m)" defaultValue={metersInput(open.widthCm)} inputMode="decimal" required />
            </div>
            <CheckboxField name="active" label="In servizio" defaultChecked={open.active} hint="Fuori servizio resta sulla mappa ma non si assegna nei contratti." />
            <Field name="notes" label="Note" defaultValue={open.notes ?? ""} />
            <Submit>Salva</Submit>
            <FormMessage />
          </Form>
          <div className="border-t border-line-soft pt-4">
            {open.used ? (
              <p className="text-sm text-muted">È in un contratto: non si può eliminare, ma puoi metterlo fuori servizio.</p>
            ) : (
              <ActionButton action={deleteParkingSpace} fields={{ id: open.id }} variant="danger" size="sm" confirm={`Eliminare il posto auto ${open.code}?`}>
                Elimina il posto auto
              </ActionButton>
            )}
          </div>
        </Drawer>
      )}
    </>
  );
}
