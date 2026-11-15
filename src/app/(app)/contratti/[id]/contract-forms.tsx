"use client";

import { useState } from "react";
import { ActionButton, Field, Form, FormMessage, SelectField, Submit, TextareaField } from "@/components/form";
import { itemHasPeriod, ITEM_KINDS } from "@/lib/contract-items";
import { CONTRACT_ITEM_LABEL } from "@/lib/labels";
import { activateContractAction, addContractItemAction, cancelContractAction, removeContractItemAction, updateContractMeta } from "@/server/contract-actions";

export function ActivateForm({ contractId, firstDueDate }: { contractId: string; firstDueDate: string }) {
  const [instalments, setInstalments] = useState(1);
  return (
    <Form action={activateContractAction} className="space-y-3">
      <input type="hidden" name="contractId" value={contractId} />
      <SelectField
        name="instalments"
        label="Numero di rate"
        value={String(instalments)}
        onChange={(e) => setInstalments(Number(e.target.value))}
        options={[1, 2, 3, 4, 6, 12].map((n) => ({ value: String(n), label: n === 1 ? "Unica soluzione" : `${n} rate` }))}
      />
      <Field name="firstDueDate" label={instalments === 1 ? "Scadenza del pagamento" : "Scadenza della prima rata"} type="date" defaultValue={firstDueDate} required />
      {instalments > 1 ? (
        <SelectField
          name="everyMonths"
          label="Cadenza"
          defaultValue="1"
          options={[1, 2, 3, 4, 6].map((n) => ({ value: String(n), label: n === 1 ? "Ogni mese" : `Ogni ${n} mesi` }))}
        />
      ) : (
        <input type="hidden" name="everyMonths" value="1" />
      )}
      <FormMessage />
      <Submit className="w-full">Attiva il contratto</Submit>
    </Form>
  );
}

export function CancelContractButton({ contractId, draft }: { contractId: string; draft: boolean }) {
  return (
    <ActionButton
      action={cancelContractAction}
      fields={{ contractId }}
      variant="danger"
      size="sm"
      confirm={draft ? "Annullare questa bozza?" : "Annullando il contratto il posto torna libero e gli addebiti non ancora incassati vengono annullati. Confermi?"}
    >
      {draft ? "Annulla la bozza" : "Annulla il contratto"}
    </ActionButton>
  );
}

export function ContractMetaForm({ contractId, signedOn, notes }: { contractId: string; signedOn: string | null; notes: string | null }) {
  return (
    <Form action={updateContractMeta} className="space-y-3">
      <input type="hidden" name="contractId" value={contractId} />
      <Field name="signedOn" label="Firmato il" type="date" defaultValue={signedOn ?? ""} />
      <TextareaField name="notes" label="Note" defaultValue={notes ?? ""} rows={3} />
      <FormMessage />
      <Submit variant="secondary" size="sm">
        Salva
      </Submit>
    </Form>
  );
}

export function AddContractItemForm({ contractId, startDate, endDate, active }: { contractId: string; startDate: string; endDate: string; active: boolean }) {
  const [kind, setKind] = useState<(typeof ITEM_KINDS)[number]>("auto_coperto");
  const period = itemHasPeriod(kind);
  // Dopo un salvataggio riuscito il modulo si svuota: anche la voce scelta torna quella iniziale.
  return (
    <div onReset={() => setKind("auto_coperto")}>
      <Form action={addContractItemAction} resetOnSuccess className="space-y-3">
        <input type="hidden" name="contractId" value={contractId} />
        <SelectField
          name="kind"
          label="Voce"
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof ITEM_KINDS)[number])}
          options={ITEM_KINDS.map((k) => ({ value: k, label: CONTRACT_ITEM_LABEL[k] }))}
        />
        {period && (
          <>
            {(kind === "auto_coperto" || kind === "auto_scoperto") && <Field name="reference" label="Numero del posto auto" />}
            <div className="grid grid-cols-2 gap-3">
              <Field name="startDate" label="Dal" type="date" defaultValue={startDate} required />
              <Field name="endDate" label="Al" type="date" defaultValue={endDate} required />
            </div>
          </>
        )}
        <Field name="amount" label="Importo (IVA inclusa)" inputMode="decimal" placeholder="0,00" required hint={active ? "L'addebito nasce subito, con scadenza oggi." : "L'addebito nasce all'attivazione."} />
        <FormMessage />
        <Submit variant="secondary" size="sm">
          Aggiungi
        </Submit>
      </Form>
    </div>
  );
}

export function RemoveContractItemButton({ itemId }: { itemId: string }) {
  return (
    <ActionButton action={removeContractItemAction} fields={{ itemId }} variant="ghost" size="sm" confirm="Togliere questa voce dal contratto? L'addebito non ancora incassato viene annullato.">
      Togli
    </ActionButton>
  );
}
