"use client";

import { useState } from "react";
import { Field, Form, FormMessage, SelectField, Submit, TextareaField } from "@/components/form";
import { sendMessageAction } from "@/server/message-actions";

type Option = { value: string; label: string };

const KIND_OPTIONS: Option[] = [
  { value: "info", label: "Informazione" },
  { value: "lavori", label: "Lavori o disservizio" },
  { value: "urgente", label: "Urgente (meteo, sicurezza)" },
];

const AUDIENCE_LABELS: Record<string, string> = {
  tutti: "Tutti i clienti con contratto attivo",
  pontile: "Un pontile",
  tipo: "Un tipo di contratto",
  in_porto: "Chi è in porto adesso",
  cliente: "Un cliente",
};

const TYPE_OPTIONS: Option[] = [
  { value: "annuale", label: "Annuali" },
  { value: "stagionale", label: "Stagionali" },
  { value: "mensile", label: "Mensili" },
  { value: "transito", label: "Transiti" },
];

export function MessageForm({
  audiences,
  piers,
  owners,
  defaults,
}: {
  audiences: string[];
  piers: Option[];
  owners: Option[];
  // windAlert: il messaggio nasce dall'allerta vento del cruscotto (all'invio si segna come inviata).
  defaults: { audienceType?: string; ownerId?: string; kind?: string; title?: string; body?: string; windAlert?: boolean };
}) {
  const [audience, setAudience] = useState(defaults.audienceType && audiences.includes(defaults.audienceType) ? defaults.audienceType : audiences[0]);
  return (
    <Form action={sendMessageAction} className="space-y-4">
      {defaults.windAlert && <input type="hidden" name="windAlert" value="1" />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          name="audienceType"
          label="A chi"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          options={audiences.map((a) => ({ value: a, label: AUDIENCE_LABELS[a] }))}
          required
        />
        {audience === "pontile" && <SelectField name="pierId" label="Pontile" options={piers} placeholder="Scegli…" required />}
        {audience === "tipo" && <SelectField name="contractType" label="Tipo di contratto" options={TYPE_OPTIONS} placeholder="Scegli…" required />}
        {audience === "cliente" && <SelectField name="ownerId" label="Cliente" options={owners} defaultValue={defaults.ownerId} placeholder="Scegli…" required />}
      </div>
      <SelectField
        name="kind"
        label="Tipo di messaggio"
        options={KIND_OPTIONS}
        defaultValue={defaults.kind ?? "info"}
        hint="Gli urgenti restano in evidenza finché non vengono letti, e vedi chi non li ha ancora aperti."
        required
      />
      <Field name="title" label="Titolo" defaultValue={defaults.title} maxLength={120} placeholder="Es. Acqua chiusa sul pontile B domani mattina" required />
      <TextareaField name="body" label="Messaggio" defaultValue={defaults.body} rows={6} maxLength={4000} required />
      <FormMessage />
      <Submit>Invia</Submit>
    </Form>
  );
}
