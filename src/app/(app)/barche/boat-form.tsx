"use client";

import Link from "next/link";
import { Field, Form, FormMessage, SelectField, Submit, TextareaField } from "@/components/form";
import { saveBoat } from "@/server/boat-actions";

export interface BoatFormValues {
  id?: string;
  ownerId?: string;
  name?: string;
  registration?: string | null;
  type?: string;
  builder?: string | null;
  model?: string | null;
  year?: number | null;
  length?: string;
  beam?: string;
  draft?: string;
  flag?: string | null;
  engine?: string | null;
  declaredValue?: string;
  engineCount?: number | null;
  engineType?: string | null;
  engineBrand?: string | null;
  enginePowerHp?: number | null;
  auxEngineCount?: number | null;
  auxEngineType?: string | null;
  auxEngineBrand?: string | null;
  auxEnginePowerHp?: number | null;
  insuranceCompany?: string | null;
  insurancePolicy?: string | null;
  insuranceExpiry?: string | null;
  notes?: string | null;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="card p-4">
      <legend className="float-left mb-3 w-full text-[15px] font-semibold text-ink">{title}</legend>
      <div className="clear-both grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

export function BoatForm({ boat, owners }: { boat?: BoatFormValues; owners: { id: string; name: string }[] }) {
  const v = boat ?? {};
  return (
    <Form action={saveBoat} className="space-y-5">
      {v.id && <input type="hidden" name="id" value={v.id} />}

      <Group title="Barca">
        <SelectField
          name="ownerId"
          label="Proprietario"
          defaultValue={v.ownerId ?? ""}
          placeholder="Scegli il cliente…"
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
          required
        />
        <Field name="name" label="Nome della barca" defaultValue={v.name ?? ""} required />
        <Field name="registration" label="Matricola / targa" defaultValue={v.registration ?? ""} hint="Lascia vuoto per i natanti non immatricolati." />
        <SelectField
          name="type"
          label="Tipo"
          defaultValue={v.type ?? "motore"}
          options={[
            { value: "motore", label: "Barca a motore" },
            { value: "vela", label: "Barca a vela" },
            { value: "gommone", label: "Gommone" },
            { value: "catamarano", label: "Catamarano" },
            { value: "altro", label: "Altro" },
          ]}
        />
        <Field name="builder" label="Cantiere" defaultValue={v.builder ?? ""} />
        <Field name="model" label="Modello" defaultValue={v.model ?? ""} />
        <Field name="year" label="Anno" defaultValue={v.year ?? ""} inputMode="numeric" />
        <Field name="flag" label="Bandiera" defaultValue={v.flag ?? "Italia"} />
        <Field name="declaredValueCents" label="Valore dichiarato (€)" defaultValue={v.declaredValue ?? ""} inputMode="decimal" placeholder="Es. 6.000" hint="Compare nel contratto." />
      </Group>

      <Group title="Motorizzazione">
        <Field name="engineCount" label="Numero di motori" defaultValue={v.engineCount ?? ""} inputMode="numeric" placeholder="1" />
        <Field name="engineType" label="Tipo" defaultValue={v.engineType ?? ""} placeholder="Es. fuoribordo, entrobordo" />
        <Field name="engineBrand" label="Marca" defaultValue={v.engineBrand ?? ""} />
        <Field name="enginePowerHp" label="Potenza (HP)" defaultValue={v.enginePowerHp ?? ""} inputMode="numeric" />
        <Field name="auxEngineCount" label="Motori ausiliari" defaultValue={v.auxEngineCount ?? ""} inputMode="numeric" placeholder="0" />
        <Field name="auxEngineType" label="Tipo ausiliario" defaultValue={v.auxEngineType ?? ""} />
        <Field name="auxEngineBrand" label="Marca ausiliario" defaultValue={v.auxEngineBrand ?? ""} />
        <Field name="auxEnginePowerHp" label="Potenza ausiliario (HP)" defaultValue={v.auxEnginePowerHp ?? ""} inputMode="numeric" />
        <Field name="engine" label="Altre note sul motore" defaultValue={v.engine ?? ""} />
      </Group>

      <Group title="Dimensioni">
        <Field name="lengthCm" label="Lunghezza fuori tutto (m)" defaultValue={v.length ?? ""} inputMode="decimal" placeholder="Es. 9,50" required />
        <Field name="beamCm" label="Larghezza massima (m)" defaultValue={v.beam ?? ""} inputMode="decimal" placeholder="Es. 3,20" required />
        <Field name="draftCm" label="Pescaggio (m)" defaultValue={v.draft ?? ""} inputMode="decimal" placeholder="Es. 1,80" />
      </Group>

      <Group title="Assicurazione">
        <Field name="insuranceCompany" label="Compagnia" defaultValue={v.insuranceCompany ?? ""} />
        <Field name="insurancePolicy" label="Numero di polizza" defaultValue={v.insurancePolicy ?? ""} />
        <Field name="insuranceExpiry" label="Scadenza" type="date" defaultValue={v.insuranceExpiry ?? ""} />
      </Group>

      <fieldset className="card p-4">
        <legend className="float-left mb-3 w-full text-[15px] font-semibold text-ink">Note</legend>
        <TextareaField name="notes" label="Note per ufficio e banchina" defaultValue={v.notes ?? ""} rows={3} wrapperClassName="clear-both" />
      </fieldset>

      <FormMessage />
      <div className="flex gap-2">
        <Submit>{v.id ? "Salva modifiche" : "Aggiungi barca"}</Submit>
        <Link href={v.id ? `/barche/${v.id}` : "/barche"} className="btn btn-ghost">
          Annulla
        </Link>
      </div>
    </Form>
  );
}
