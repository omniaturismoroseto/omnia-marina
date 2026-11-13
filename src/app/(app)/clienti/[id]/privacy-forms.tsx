"use client";

import { ActionButton, Form, FormMessage, SelectField, Submit, Field } from "@/components/form";
import { eraseOwner, recordConsent } from "@/server/owner-actions";

export function ConsentForm({ ownerId, kind, currentlyGranted }: { ownerId: string; kind: "informativa" | "marketing" | "terzi"; currentlyGranted: boolean }) {
  return (
    <Form action={recordConsent} resetOnSuccess className="mt-2 space-y-2 rounded-md bg-paper p-3">
      <input type="hidden" name="ownerId" value={ownerId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SelectField
          name="granted"
          label="Esito"
          defaultValue={currentlyGranted ? "false" : "true"}
          options={[
            { value: "true", label: kind === "informativa" ? "Firmata" : "Consenso dato" },
            { value: "false", label: kind === "informativa" ? "Non firmata" : "Consenso negato o revocato" },
          ]}
        />
        <SelectField
          name="method"
          label="Raccolto con"
          defaultValue="cartaceo"
          options={[
            { value: "cartaceo", label: "Modulo cartaceo" },
            { value: "digitale", label: "Modulo digitale" },
            { value: "verbale", label: "Verbale" },
          ]}
        />
      </div>
      <Field name="note" label="Nota (facoltativa)" />
      <FormMessage />
      <Submit size="sm">Registra</Submit>
    </Form>
  );
}

export function EraseOwnerButton({ ownerId, hasHistory }: { ownerId: string; hasHistory: boolean }) {
  return (
    <ActionButton
      action={eraseOwner}
      fields={{ ownerId }}
      variant="danger"
      size="sm"
      confirm={
        hasHistory
          ? "I dati personali del cliente verranno cancellati in modo definitivo. Contratti e movimenti contabili restano, senza più riferimenti alla persona. Confermi?"
          : "Il cliente verrà eliminato in modo definitivo. Confermi?"
      }
    >
      {hasHistory ? "Anonimizza i dati personali" : "Elimina cliente"}
    </ActionButton>
  );
}
