"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckboxField, Field, Form, FormMessage, SelectField, Submit } from "@/components/form";
import { generateBerths } from "@/server/settings-actions";
import type { ManagerCategory, ManagerSection } from "./types";

interface Values {
  prefix: string;
  from: string;
  to: string;
  layout: string;
  categoryId: string;
}

/**
 * «Aggiungi posti» con l'anteprima di ciò che verrà creato (codici, lati, categoria; in rosso i codici che esistono già e
 * verranno saltati). Nei pontili uniti si sceglie il tratto; «secondo la sigla» li mette dove sta il posto con la stessa sigla.
 */
export function AddBerthsPanel({
  pierId,
  pierName,
  prefix,
  nextNumber,
  sections,
  sectionId,
  categories,
  existingCodes,
  hasPlan,
}: {
  pierId: string;
  pierName: string;
  prefix: string;
  nextNumber: number;
  sections: ManagerSection[];
  sectionId: string | null;
  categories: ManagerCategory[];
  existingCodes: Set<string>;
  hasPlan: boolean;
}) {
  const [values, setValues] = useState<Values>({ prefix, from: String(nextNumber), to: String(nextNumber + 9), layout: "alternati", categoryId: "" });

  if (categories.length === 0) {
    return (
      <p className="text-sm text-warn">
        Servono prima le{" "}
        <Link href="/impostazioni/categorie" className="link">
          categorie
        </Link>
        .
      </p>
    );
  }

  const read = (form: HTMLFormElement) => {
    const data = new FormData(form);
    setValues({
      prefix: String(data.get("prefix") ?? ""),
      from: String(data.get("from") ?? ""),
      to: String(data.get("to") ?? ""),
      layout: String(data.get("layout") ?? "alternati"),
      categoryId: String(data.get("categoryId") ?? ""),
    });
  };

  return (
    <div
      className="rounded-md border border-dashed border-line bg-paper p-3"
      onInput={(e) => {
        const form = (e.target as HTMLElement).closest("form");
        if (form) read(form);
      }}
      onChange={(e) => {
        const form = (e.target as HTMLElement).closest("form");
        if (form) read(form);
      }}
    >
      <Form action={generateBerths} className="space-y-3">
        <input type="hidden" name="pierId" value={pierId} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field name="prefix" label="Sigla" defaultValue={prefix} maxLength={4} required />
          <Field name="from" label="Dal numero" defaultValue={String(nextNumber)} inputMode="numeric" required />
          <Field name="to" label="Al numero" defaultValue={String(nextNumber + 9)} inputMode="numeric" required />
          <SelectField
            name="layout"
            label="Disposizione"
            defaultValue="alternati"
            options={[
              { value: "alternati", label: "Sui due lati, alternati" },
              { value: "sx", label: "Solo lato sinistro" },
              { value: "dx", label: "Solo lato destro" },
            ]}
          />
          <SelectField name="categoryId" label="Categoria" options={categories.map((c) => ({ value: c.id, label: c.label }))} placeholder="Scegli…" required />
          <Field name="draftCm" label="Fondale (m)" inputMode="decimal" placeholder="Es. 3,00" />
          {sections.length > 0 && (
            <SelectField
              name="sectionId"
              label="Tratto"
              defaultValue={sectionId ?? ""}
              placeholder="Secondo la sigla"
              wrapperClassName="col-span-2 sm:col-span-1"
              options={sections.map((s) => ({ value: s.id, label: `Tratto ${s.label}` }))}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <CheckboxField name="hasWater" label="Acqua" defaultChecked />
          <CheckboxField name="hasPower" label="Corrente" defaultChecked />
        </div>
        <Preview values={values} pierName={pierName} categories={categories} existingCodes={existingCodes} hasPlan={hasPlan} />
        <div className="flex flex-wrap items-center gap-3">
          <Submit>Crea i posti</Submit>
          <FormMessage />
        </div>
      </Form>
    </div>
  );
}

function Preview({
  values,
  pierName,
  categories,
  existingCodes,
  hasPlan,
}: {
  values: Values;
  pierName: string;
  categories: ManagerCategory[];
  existingCodes: Set<string>;
  hasPlan: boolean;
}) {
  const prefix = values.prefix.trim().toUpperCase();
  const from = Number.parseInt(values.from, 10);
  const to = Number.parseInt(values.to, 10);
  const box = "rounded-md border border-line-soft bg-card px-3 py-2 text-sm";
  if (!prefix || !Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return <p className={`${box} text-muted`}>Scrivi sigla e numeri: qui vedrai i posti che verranno creati.</p>;
  }
  if (to - from >= 200) return <p className={`${box} text-bad`}>Al massimo 200 posti per volta.</p>;
  const codes = Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
  const fresh = codes.filter((c) => !existingCodes.has(c.toUpperCase()));
  const skipped = codes.length - fresh.length;
  const sides =
    values.layout === "sx"
      ? "tutti a sinistra"
      : values.layout === "dx"
        ? "tutti a destra"
        : `${Math.ceil(fresh.length / 2)} a sinistra e ${Math.floor(fresh.length / 2)} a destra`;
  const category = categories.find((c) => c.id === values.categoryId);
  return (
    <div className={box}>
      <p>
        <strong className="font-semibold text-ink">
          {fresh.length === 1 ? "Creerai 1 posto" : `Creerai ${fresh.length} posti`}
        </strong>{" "}
        su {pierName}: {sides}
        {category ? `, categoria ${category.label}` : ""}.
        {skipped > 0 && <span className="text-bad"> {skipped === 1 ? "1 codice esiste già e verrà saltato." : `${skipped} codici esistono già e verranno saltati.`}</span>}
        {hasPlan && fresh.length > 0 && <span className="text-muted"> Sulla mappa del porto si mettono da soli dopo gli altri.</span>}
      </p>
      <p className="mt-2 flex flex-wrap gap-1">
        {codes.slice(0, 40).map((c) => (
          <span
            key={c}
            className={`rounded px-1.5 py-px text-xs font-semibold tabular-nums ${existingCodes.has(c.toUpperCase()) ? "bg-bad-soft text-bad line-through" : "bg-ok-soft text-ok"}`}
          >
            {c}
          </span>
        ))}
        {codes.length > 40 && <span className="text-xs text-muted">…</span>}
      </p>
    </div>
  );
}
