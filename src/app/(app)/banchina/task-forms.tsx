"use client";

import { useState } from "react";
import { ActionButton, Field, Form, FormMessage, SelectField, Submit, TextareaField } from "@/components/form";
import { createTask, setTaskStatus } from "@/server/dock-actions";

export function NewTaskForm({ berths }: { berths: { id: string; code: string }[] }) {
  return (
    <Form action={createTask} resetOnSuccess className="space-y-3">
      <Field name="title" label="Cosa succede" placeholder="Es. colonnina senza corrente" required />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SelectField
          name="kind"
          label="Tipo"
          defaultValue="segnalazione"
          options={[
            { value: "segnalazione", label: "Segnalazione" },
            { value: "manutenzione", label: "Manutenzione" },
            { value: "assistenza", label: "Assistenza all'ormeggio" },
            { value: "servizio", label: "Servizio richiesto" },
          ]}
        />
        <SelectField
          name="priority"
          label="Priorità"
          defaultValue="normale"
          options={[
            { value: "bassa", label: "Bassa" },
            { value: "normale", label: "Normale" },
            { value: "alta", label: "Urgente" },
          ]}
        />
        <SelectField name="berthId" label="Posto barca" placeholder="Nessuno" options={berths.map((b) => ({ value: b.id, label: b.code }))} />
      </div>
      <TextareaField name="description" label="Dettagli" rows={2} />
      <FormMessage />
      <Submit>Registra segnalazione</Submit>
    </Form>
  );
}

export function TaskActions({ taskId, status }: { taskId: string; status: "aperta" | "in_corso" }) {
  const [closing, setClosing] = useState(false);
  if (closing) {
    return (
      <Form action={setTaskStatus} className="mt-2 space-y-2">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="status" value="chiusa" />
        <Field name="resolution" label="Com'è stata risolta (facoltativo)" />
        <FormMessage />
        <div className="flex gap-2">
          <Submit size="sm">Chiudi segnalazione</Submit>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClosing(false)}>
            Annulla
          </button>
        </div>
      </Form>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {status === "aperta" && (
        <ActionButton action={setTaskStatus} fields={{ taskId, status: "in_corso" }} size="sm">
          Prendi in carico
        </ActionButton>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClosing(true)}>
        Chiudi
      </button>
    </div>
  );
}
