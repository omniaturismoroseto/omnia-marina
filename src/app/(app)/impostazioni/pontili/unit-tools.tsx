"use client";

import { ActionButton, Field, Form, FormMessage, SelectField, Submit } from "@/components/form";
import { arrangeBerths, dissolveSectionAction, renameSectionAction, splitPierAt, splitSectionAction } from "@/server/settings-actions";

// Comandi di una struttura della pianta: un tratto di un pontile unito o, con sectionId vuoto, il pontile intero.

export function ArrangeForm({ pierId, sectionId, hasPlan }: { pierId: string; sectionId: string | null; hasPlan: boolean }) {
  return (
    <Form action={arrangeBerths} className="space-y-3">
      <input type="hidden" name="pierId" value={pierId} />
      {sectionId && <input type="hidden" name="sectionId" value={sectionId} />}
      <p className="text-sm text-muted">
        I posti si rimettono in ordine di codice a partire dalla radice{sectionId ? " del tratto" : ""}.
        {hasPlan ? " Sulla pianta si ridispongono da soli lungo la linea, alla stessa distanza uno dall'altro." : ""} Misure, contratti e codici non cambiano.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          name="layout"
          label="Lati"
          defaultValue="alternati"
          wrapperClassName="min-w-56"
          options={[
            { value: "alternati", label: "Sui due lati, alternati" },
            { value: "sx", label: "Tutti sul lato sinistro" },
            { value: "dx", label: "Tutti sul lato destro" },
          ]}
        />
        <Submit variant="secondary">Ridisponi i posti</Submit>
      </div>
      <FormMessage />
    </Form>
  );
}

export function RenameSectionForm({ sectionId, label }: { sectionId: string; label: string }) {
  return (
    <Form action={renameSectionAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="sectionId" value={sectionId} />
      <Field name="label" label="Nome del tratto" defaultValue={label} maxLength={20} required />
      <Submit variant="secondary">Salva</Submit>
      <FormMessage />
    </Form>
  );
}

export function SplitSectionForm({ sectionId, code, name }: { sectionId: string; code: string; name: string }) {
  return (
    <Form action={splitSectionAction} className="space-y-3">
      <input type="hidden" name="sectionId" value={sectionId} />
      <p className="text-sm text-muted">
        Il tratto torna un pontile a sé con i suoi posti, la sua linea sulla pianta e gli stessi prezzi del pontile da cui viene (poi li cambi in
        Tariffe, se serve). Con un nome diverso compare come pontile separato in elenchi e tariffe.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[6rem_1fr_auto] sm:items-end">
        <Field name="code" label="Sigla" defaultValue={code} maxLength={4} required />
        <Field name="name" label="Nome" defaultValue={name} required />
        <Submit variant="secondary">Separa</Submit>
      </div>
      <FormMessage />
    </Form>
  );
}

export function DissolveSectionButton({ sectionId, label }: { sectionId: string; label: string }) {
  return (
    <ActionButton
      action={dissolveSectionAction}
      fields={{ sectionId }}
      size="sm"
      variant="ghost"
      confirm={`Togliere il tratto «${label}»? I suoi posti restano nel pontile, ma sulla pianta non si spostano più da soli.`}
    >
      Togli tratto
    </ActionButton>
  );
}

/** Divide il pontile (o il tratto) in due tratti dello stesso pontile, dal posto scelto in poi. */
export function SplitAtForm({
  pierId,
  sectionId,
  berths,
  first,
  second,
}: {
  pierId: string;
  sectionId: string | null;
  /** Posti in ordine di codice. */
  berths: { id: string; code: string }[];
  first: string;
  second: string;
}) {
  const middle = berths[Math.floor(berths.length / 2)];
  return (
    <Form action={splitPierAt} className="space-y-3">
      <input type="hidden" name="pierId" value={pierId} />
      {sectionId && <input type="hidden" name="sectionId" value={sectionId} />}
      <p className="text-sm text-muted">
        Il pontile resta uno solo: stessa sigla, stessa categoria e stessi prezzi, e i posti tengono i loro numeri. Diventa due tratti che sulla
        mappa del porto si spostano, ruotano e tracciano da soli.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SelectField
          name="fromBerthId"
          label="Il secondo tratto parte da"
          defaultValue={middle?.id}
          options={berths.slice(1).map((b) => ({ value: b.id, label: b.code }))}
        />
        <Field name="first" label="Nome del primo tratto" defaultValue={first} maxLength={20} required />
        <Field name="second" label="Nome del secondo tratto" defaultValue={second} maxLength={20} required />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit variant="secondary">Dividi</Submit>
        <FormMessage />
      </div>
    </Form>
  );
}
