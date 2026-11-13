"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckboxField, Field, Form, FormMessage, SelectField, Submit, TextareaField } from "@/components/form";
import { saveOwner } from "@/server/owner-actions";

export interface OwnerFormValues {
  id?: string;
  type: "persona" | "azienda";
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  fiscalCode?: string | null;
  vatNumber?: string | null;
  birthDate?: string | null;
  birthPlace?: string | null;
  address?: string | null;
  zip?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  pec?: string | null;
  sdiCode?: string | null;
  idDocType?: string | null;
  idDocNumber?: string | null;
  idDocExpiry?: string | null;
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

export function OwnerForm({ owner, policyVersion }: { owner?: OwnerFormValues; policyVersion: string }) {
  const [type, setType] = useState<"persona" | "azienda">(owner?.type ?? "persona");
  const v = owner ?? { type };
  const editing = Boolean(owner?.id);

  return (
    <Form action={saveOwner} className="space-y-5">
      {owner?.id && <input type="hidden" name="id" value={owner.id} />}

      <Group title="Intestatario">
        <SelectField
          name="type"
          label="Tipo"
          value={type}
          onChange={(e) => setType(e.target.value as "persona" | "azienda")}
          options={[
            { value: "persona", label: "Persona fisica" },
            { value: "azienda", label: "Azienda o ente" },
          ]}
        />
        {type === "persona" ? (
          <>
            <Field name="lastName" label="Cognome" defaultValue={v.lastName ?? ""} required autoComplete="off" />
            <Field name="firstName" label="Nome" defaultValue={v.firstName ?? ""} required autoComplete="off" />
            <Field name="fiscalCode" label="Codice fiscale" defaultValue={v.fiscalCode ?? ""} autoCapitalize="characters" />
            <Field name="birthDate" label="Data di nascita" type="date" defaultValue={v.birthDate ?? ""} />
            <Field name="birthPlace" label="Luogo di nascita" defaultValue={v.birthPlace ?? ""} />
          </>
        ) : (
          <>
            <Field name="companyName" label="Ragione sociale" defaultValue={v.companyName ?? ""} required wrapperClassName="sm:col-span-2" />
            <Field name="vatNumber" label="Partita IVA" defaultValue={v.vatNumber ?? ""} />
            <Field name="fiscalCode" label="Codice fiscale" defaultValue={v.fiscalCode ?? ""} />
            <Field name="sdiCode" label="Codice destinatario (SdI)" defaultValue={v.sdiCode ?? ""} />
          </>
        )}
      </Group>

      <Group title="Contatti">
        <Field name="phone" label="Telefono" type="tel" defaultValue={v.phone ?? ""} />
        <Field name="email" label="Email" type="email" defaultValue={v.email ?? ""} />
        <Field name="pec" label="PEC" type="email" defaultValue={v.pec ?? ""} />
      </Group>

      <Group title="Indirizzo">
        <Field name="address" label="Via e numero civico" defaultValue={v.address ?? ""} wrapperClassName="sm:col-span-2" />
        <Field name="zip" label="CAP" defaultValue={v.zip ?? ""} inputMode="numeric" />
        <Field name="city" label="Comune" defaultValue={v.city ?? ""} />
        <Field name="province" label="Provincia" defaultValue={v.province ?? ""} maxLength={2} placeholder="Es. PE" />
        <Field name="country" label="Paese" defaultValue={v.country ?? "Italia"} />
      </Group>

      {type === "persona" && (
        <Group title="Documento di identità">
          <SelectField
            name="idDocType"
            label="Tipo di documento"
            defaultValue={v.idDocType ?? ""}
            placeholder="—"
            options={["Carta d'identità", "Passaporto", "Patente di guida"].map((d) => ({ value: d, label: d }))}
          />
          <Field name="idDocNumber" label="Numero" defaultValue={v.idDocNumber ?? ""} />
          <Field name="idDocExpiry" label="Scadenza" type="date" defaultValue={v.idDocExpiry ?? ""} />
        </Group>
      )}

      <fieldset className="card p-4">
        <legend className="float-left mb-3 w-full text-[15px] font-semibold text-ink">Note interne</legend>
        <TextareaField name="notes" label="Note" defaultValue={v.notes ?? ""} rows={3} wrapperClassName="clear-both" hint="Visibili solo a direzione e ufficio." />
      </fieldset>

      {!editing && (
        <fieldset className="card p-4">
          <legend className="float-left mb-1 w-full text-[15px] font-semibold text-ink">Privacy</legend>
          <p className="clear-both mb-3 text-sm text-muted">
            Spunta ciò che il cliente ha firmato. Verrà registrato con data di oggi e versione {policyVersion} dell&apos;informativa; potrai aggiornarlo in ogni momento dalla scheda del cliente.
          </p>
          <div className="space-y-3">
            <CheckboxField name="consentInformativa" label="Ha ricevuto e firmato l'informativa sul trattamento dei dati" />
            <CheckboxField name="consentMarketing" label="Acconsente a ricevere comunicazioni commerciali" hint="Facoltativo." />
            <CheckboxField name="consentTerzi" label="Acconsente alla comunicazione dei dati a cantieri e assistenza" hint="Facoltativo." />
            <SelectField
              name="consentMethod"
              label="Come è stato raccolto"
              defaultValue="cartaceo"
              wrapperClassName="max-w-xs"
              options={[
                { value: "cartaceo", label: "Modulo cartaceo firmato" },
                { value: "digitale", label: "Modulo digitale" },
                { value: "verbale", label: "Verbale" },
              ]}
            />
          </div>
        </fieldset>
      )}

      <FormMessage />
      <div className="flex gap-2">
        <Submit>{editing ? "Salva modifiche" : "Crea cliente"}</Submit>
        <Link href={owner?.id ? `/clienti/${owner.id}` : "/clienti"} className="btn btn-ghost">
          Annulla
        </Link>
      </div>
    </Form>
  );
}
