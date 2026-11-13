"use client";

import { useState } from "react";
import { ActionButton, Field, Form, FormMessage, SelectField, Submit, TextareaField } from "@/components/form";
import { activateContractAction, cancelContractAction, updateContractMeta } from "@/server/contract-actions";

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
