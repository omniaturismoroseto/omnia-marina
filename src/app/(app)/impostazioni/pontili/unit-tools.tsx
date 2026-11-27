"use client";

import { useState } from "react";
import { ActionButton, Field, Form, FormMessage, SelectField, Submit } from "@/components/form";
import {
  arrangeBerths,
  dissolveSectionAction,
  flipBerthNumbering,
  renameModuleAction,
  renameSectionAction,
  splitSectionAction,
} from "@/server/settings-actions";

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

export function RenameSectionForm({ sectionId, label, onDone }: { sectionId: string; label: string; onDone?: () => void }) {
  return (
    <Form action={renameSectionAction} className="flex flex-wrap items-end gap-3" onSuccess={onDone}>
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


/**
 * Numerazione del tratto (o di un suo modulo) girata: dall'altra estremità o con i lati scambiati. I posti tengono codici,
 * misure e contratti; cambia dove stanno, anche sulla pianta.
 */
export function NumberingForm({ pierId, scopes, hasPlan }: { pierId: string; scopes: { label: string; berthIds: string[] }[]; hasPlan: boolean }) {
  const [scope, setScope] = useState(0);
  const chosen = scopes[Math.min(scope, scopes.length - 1)];
  const fields = (mode: "estremi" | "lati") => ({ pierId, mode, berthIds: chosen.berthIds.join(",") });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Per far partire i numeri dall&apos;altra testata o dall&apos;altro lato. Scegli un tratto intero, un modulo o una fila (per esempio con
        «Tratto …» o «da… a…»). Ogni posto tiene codice, misure e contratti: cambia solo dove sta{hasPlan ? ", anche sulla mappa" : ""}.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        {scopes.length > 1 && (
          <label className="min-w-56">
            <span className="label">Quali posti</span>
            <select className="input" value={scope} onChange={(e) => setScope(Number(e.target.value))}>
              {scopes.map((sc, i) => (
                <option key={sc.label} value={i}>
                  {sc.label} ({sc.berthIds.length} posti)
                </option>
              ))}
            </select>
          </label>
        )}
        <ActionButton action={flipBerthNumbering} fields={fields("estremi")}>
          Parti dall&apos;altra estremità
        </ActionButton>
        <ActionButton action={flipBerthNumbering} fields={fields("lati")}>
          Scambia i lati
        </ActionButton>
      </div>
      <p className="hint">
        «Parti dall&apos;altra estremità»: il primo posto va dove c&apos;era l&apos;ultimo. «Scambia i lati»: i posti di sinistra passano a
        destra e viceversa.
      </p>
    </div>
  );
}

/** Nome di un modulo (vuoto = torna «Modulo N»). Salvato, il riquadro si chiude da solo. */
export function ModuleNameForm({ pierId, module, berthIds, name, onDone }: { pierId: string; module: number; berthIds: string[]; name: string; onDone: () => void }) {
  return (
    <Form action={renameModuleAction} className="flex flex-wrap items-end gap-2" onSuccess={onDone}>
      <input type="hidden" name="pierId" value={pierId} />
      <input type="hidden" name="module" value={module} />
      <input type="hidden" name="berthIds" value={berthIds.join(",")} />
      <Field name="name" label="Nome del modulo" defaultValue={name} maxLength={30} placeholder="Es. Testata, Lato bar" autoFocus />
      <Submit variant="secondary" size="sm">
        Salva
      </Submit>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
        Annulla
      </button>
      <FormMessage />
    </Form>
  );
}
