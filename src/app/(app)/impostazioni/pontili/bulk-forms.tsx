"use client";

import { CheckboxField, Field, Form, FormMessage, SelectField, Submit } from "@/components/form";
import { deleteBerths, makeBerthSection, renameBerths, setBerthModuleAction, updateBerths } from "@/server/settings-actions";
import { Notice } from "@/components/ui";
import type { ManagerBerth, ManagerCategory } from "./types";

// Moduli della barra «posti scelti»: ognuno lavora sui posti scelti di un pontile (pierId + berthIds).

const KEEP = "Non cambiare";
const YES_NO = [
  { value: "si", label: "Sì" },
  { value: "no", label: "No" },
];

function Hidden({ pierId, berths }: { pierId: string; berths: ManagerBerth[] }) {
  return (
    <>
      <input type="hidden" name="pierId" value={pierId} />
      <input type="hidden" name="berthIds" value={berths.map((b) => b.id).join(",")} />
    </>
  );
}

export function pickedSummary(berths: ManagerBerth[]): string {
  const codes = berths.map((b) => b.code);
  return `${codes.slice(0, 12).join(", ")}${codes.length > 12 ? "…" : ""}`;
}

export function BulkEditForm({ pierId, berths, categories }: { pierId: string; berths: ManagerBerth[]; categories: ManagerCategory[] }) {
  return (
    <Form action={updateBerths} className="space-y-4">
      <Hidden pierId={pierId} berths={berths} />
      <p className="text-sm text-muted">Cambia solo quello che scegli: i campi lasciati su «{KEEP}» o vuoti restano come sono in ogni posto.</p>
      <SelectField name="categoryId" label="Categoria" placeholder={KEEP} options={categories.map((c) => ({ value: c.id, label: c.label }))} />
      <CheckboxField name="categorySizes" label="Con lunghezza e larghezza della categoria" hint="Al posto delle misure scritte qui sotto." />
      <SelectField
        name="status"
        label="Stato"
        placeholder={KEEP}
        options={[
          { value: "attivo", label: "In servizio" },
          { value: "manutenzione", label: "In manutenzione" },
          { value: "fuori_servizio", label: "Fuori servizio" },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field name="lengthCm" label="Lunghezza (m)" inputMode="decimal" placeholder={KEEP} />
        <Field name="beamCm" label="Larghezza (m)" inputMode="decimal" placeholder={KEEP} />
        <Field name="draftCm" label="Fondale (m)" inputMode="decimal" placeholder={KEEP} />
        <span />
        <SelectField name="hasWater" label="Acqua" placeholder={KEEP} options={YES_NO} />
        <SelectField name="hasPower" label="Corrente" placeholder={KEEP} options={YES_NO} />
      </div>
      <Submit>{berths.length === 1 ? "Applica al posto" : `Applica a ${berths.length} posti`}</Submit>
      <FormMessage />
    </Form>
  );
}

export function BulkCodesForm({ pierId, berths, prefix }: { pierId: string; berths: ManagerBerth[]; prefix: string }) {
  // Posti con un contratto attivo: il loro codice non cambia, quindi l'app non cambia nessun codice finché sono tra quelli scelti.
  const locked = berths.filter((b) => b.activeContract);
  return (
    <Form action={renameBerths} className="space-y-4">
      <Hidden pierId={pierId} berths={berths} />
      {locked.length > 0 && (
        <Notice tone="warn">
          {locked.length === 1 ? `Il posto ${locked[0].code} ha` : `I posti ${locked.map((b) => b.code).join(", ")} hanno`} un contratto attivo: i
          contratti attivi non si modificano, quindi il codice non si può cambiare. Toglili dalla scelta, oppure chiudi o annulla il contratto,
          cambia il codice e fai un nuovo contratto per quel posto.
        </Notice>
      )}
      <p className="text-sm text-muted">
        Nuova sigla per i posti scelti, per esempio da CN1 a {prefix || "G"}1. Se hanno sigle diverse con gli stessi numeri (CN1 e CS1), scegli
        «Rinumera in fila»: in ordine di codice prendono i numeri dal primo in poi. Contratti e pianta restano collegati.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field name="prefix" label="Nuova sigla" defaultValue={prefix} maxLength={6} required />
        <Field name="from" label="Primo numero (se rinumeri)" defaultValue="1" inputMode="numeric" />
      </div>
      <SelectField
        name="numbering"
        label="Numeri"
        defaultValue="mantieni"
        options={[
          { value: "mantieni", label: "Mantieni i numeri" },
          { value: "rinumera", label: "Rinumera in fila" },
        ]}
      />
      <Submit>{berths.length === 1 ? "Cambia il codice" : `Cambia ${berths.length} codici`}</Submit>
      <FormMessage />
    </Form>
  );
}

export function BulkSectionForm({ pierId, berths }: { pierId: string; berths: ManagerBerth[] }) {
  const letters = berths.map((b) => b.code.replace(/\d+$/, ""));
  const label = letters.every((l) => l === letters[0]) ? (letters[0] ?? "") : "";
  return (
    <Form action={makeBerthSection} className="space-y-4">
      <Hidden pierId={pierId} berths={berths} />
      <p className="text-sm text-muted">
        Il pontile si divide: i posti scelti diventano un tratto a sé, che nella Mappa del porto si sposta, ruota e traccia da solo (per esempio
        un braccio del pontile). Per la gestione il pontile resta uno solo, con la stessa sigla, categoria e prezzi.
      </p>
      <Field name="label" label="Nome del tratto" defaultValue={label} maxLength={20} required />
      <Submit>Dividi</Submit>
      <FormMessage />
    </Form>
  );
}

export function BulkDeleteForm({ pierId, berths }: { pierId: string; berths: ManagerBerth[] }) {
  const linked = berths.filter((b) => b.occupant);
  return (
    <Form action={deleteBerths} className="space-y-4">
      <Hidden pierId={pierId} berths={berths} />
      <div className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
        <p className="font-medium">
          {berths.length === 1 ? `Il posto ${berths[0].code} verrà eliminato.` : `${berths.length} posti verranno eliminati.`}
        </p>
        <p className="mt-1">
          I posti con contratti (anche conclusi) non si eliminano: restano e vanno messi fuori servizio.
          {linked.length > 0 && ` Oggi ne sono occupati ${linked.length}: ${linked.map((b) => b.code).slice(0, 8).join(", ")}${linked.length > 8 ? "…" : ""}.`}
        </p>
      </div>
      <Submit variant="danger">Elimina</Submit>
      <FormMessage />
    </Form>
  );
}

/**
 * Moduli della pianta: i posti scelti (dello stesso tratto) diventano un modulo nuovo, solo loro, oppure entrano in un modulo che c'è
 * già. `layout` sono i moduli del tratto come li mostra la scheda: il server li fissa così, insieme alla scelta.
 */
export function BulkModuleForm({
  pierId,
  berths,
  modules,
  layout,
  onDone,
  regroup = null,
}: {
  pierId: string;
  berths: ManagerBerth[];
  modules: { module: number; label: string }[];
  layout: { id: string; module: number | null }[];
  onDone: () => void;
  /** Posti di tratti diversi: i nomi dei tratti e il nome proposto per il tratto che li riunisce. */
  regroup?: { tratti: string[]; label: string } | null;
}) {
  if (regroup) {
    return (
      <Form action={setBerthModuleAction} className="space-y-4" onSuccess={onDone}>
        <Hidden pierId={pierId} berths={berths} />
        <input type="hidden" name="regroup" value="1" />
        <input type="hidden" name="target" value="new" />
        <p className="text-sm text-muted">
          I posti scelti sono in {regroup.tratti.length} tratti diversi ({regroup.tratti.join(", ")}). Li riunisco in un tratto solo, che sulla
          mappa si sposta e si traccia da sé, e ne faccio un modulo. I tratti che restano senza posti spariscono; il pontile resta uno solo.
        </p>
        <Field name="label" label="Nome del tratto" defaultValue={regroup.label} maxLength={20} required />
        <Submit>Riunisci e unisci</Submit>
        <FormMessage />
      </Form>
    );
  }
  return (
    <Form action={setBerthModuleAction} className="space-y-4" onSuccess={onDone}>
      <Hidden pierId={pierId} berths={berths} />
      <input type="hidden" name="layout" value={JSON.stringify(layout)} />
      <p className="text-sm text-muted">
        Un modulo è un pezzo del pontile che sulla mappa si sposta e ruota insieme. Unisci i posti scelti (anche di più moduli) in un modulo
        solo, oppure aggiungili a un modulo che esiste già. I moduli che restano vuoti spariscono.
      </p>
      <SelectField
        name="target"
        label="Cosa fare"
        defaultValue="new"
        options={[
          { value: "new", label: "Uniscili in un modulo solo" },
          ...modules.map((m) => ({ value: String(m.module), label: `Aggiungili a: ${m.label}` })),
        ]}
      />
      <Submit>Unisci</Submit>
      <FormMessage />
    </Form>
  );
}
