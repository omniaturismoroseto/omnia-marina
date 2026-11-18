"use client";

import Link from "next/link";
import { ActionButton, CheckboxField, Field, Form, FormMessage, SelectField, Submit, TextareaField } from "@/components/form";
import { moneyInput } from "@/lib/format";
import { CONTRACT_APPROVAL_TEMPLATE, CONTRACT_TERMS_TEMPLATE } from "@/lib/contract-texts";
import {
  addMember,
  changeMemberRole,
  changeOwnPassword,
  deleteBerth,
  deleteCategory,
  deletePier,
  generateBerths,
  removeMember,
  resetMemberPassword,
  saveBerth,
  saveBoaterSettings,
  saveCategory,
  saveLegalTexts,
  saveMarina,
  savePier,
} from "@/server/settings-actions";

const VAT_OPTIONS = [22, 10, 5, 4, 0].map((r) => ({ value: String(r), label: `${r}%` }));
const ROLE_OPTIONS = [
  { value: "banchina", label: "Operatore di banchina" },
  { value: "ufficio", label: "Ufficio" },
  { value: "admin", label: "Direzione" },
];

type Marina = Record<
  "name" | "legalName" | "vatNumber" | "fiscalCode" | "address" | "zip" | "city" | "province" | "phone" | "email" | "vhfChannel",
  string | null
> & { defaultVatRate: number; serviceFeeCents: number | null; wasteFeeCents: number | null; formerOwnerLabel: string };

export function MarinaForm({ marina }: { marina: Marina }) {
  return (
    <Form action={saveMarina} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="name" label="Nome del porto" defaultValue={marina.name ?? ""} required hint="Come compare nell'app." />
        <Field name="legalName" label="Ragione sociale" defaultValue={marina.legalName ?? ""} hint="Compare su contratti e informativa." />
        <Field name="vatNumber" label="Partita IVA" defaultValue={marina.vatNumber ?? ""} />
        <Field name="fiscalCode" label="Codice fiscale" defaultValue={marina.fiscalCode ?? ""} />
        <Field name="address" label="Indirizzo" defaultValue={marina.address ?? ""} />
        <Field name="zip" label="CAP" defaultValue={marina.zip ?? ""} />
        <Field name="city" label="Comune" defaultValue={marina.city ?? ""} />
        <Field name="province" label="Provincia" defaultValue={marina.province ?? ""} maxLength={2} />
        <Field name="phone" label="Telefono" type="tel" defaultValue={marina.phone ?? ""} />
        <Field name="email" label="Email" type="email" defaultValue={marina.email ?? ""} />
        <Field name="vhfChannel" label="Canale VHF" defaultValue={marina.vhfChannel ?? ""} placeholder="Es. 09" />
        <SelectField name="defaultVatRate" label="Aliquota IVA abituale" defaultValue={String(marina.defaultVatRate)} options={VAT_OPTIONS} />
        <Field
          name="serviceFeeCents"
          label="Spese di gestione comuni (€)"
          defaultValue={moneyInput(marina.serviceFeeCents)}
          inputMode="decimal"
          placeholder="Es. 150,00"
          hint="Proposte nei nuovi contratti annuali (art. 3)."
        />
        <Field
          name="wasteFeeCents"
          label="Quota rifiuti (€)"
          defaultValue={moneyInput(marina.wasteFeeCents)}
          inputMode="decimal"
          placeholder="Es. 40,00"
          hint="Proposta nei nuovi contratti annuali (art. 3)."
        />
        <Field
          name="formerOwnerLabel"
          label="Categoria dei clienti senza contratto"
          defaultValue={marina.formerOwnerLabel}
          required
          maxLength={40}
          hint="Nome della spunta per chi non ha più un contratto attivo, es. «Ex cliente»."
        />
      </div>
      <div className="flex items-center gap-3">
        <Submit>Salva</Submit>
        <FormMessage />
      </div>
    </Form>
  );
}

// Rimette nel campo il testo modello; si salva solo premendo "Salva i testi".
function RestoreTemplate({ field, text }: { field: string; text: string }) {
  return (
    <button
      type="button"
      className="link text-sm"
      onClick={(e) => {
        const el = e.currentTarget.form?.elements.namedItem(field);
        if (el instanceof HTMLTextAreaElement && (el.value.trim() === "" || window.confirm("Sostituire il testo attuale con il modello?"))) el.value = text;
      }}
    >
      Usa il testo modello
    </button>
  );
}

export function BoaterSettingsForm({
  officeHours,
  boaterInfo,
  coordinates,
  windAlertKnots,
  waveAlertM,
  windAlertAuto,
  alertZone,
  zoneNames,
  detectedZone,
}: {
  officeHours: string;
  boaterInfo: string;
  coordinates: string;
  windAlertKnots: number;
  waveAlertM: number;
  alertZone: string;
  // Zone di allerta dell'ultimo bollettino della Protezione Civile (vuoto se non raggiungibile) e quella trovata dal Comune.
  zoneNames: string[];
  detectedZone: string | null;
  windAlertAuto: boolean;
}) {
  return (
    <Form action={saveBoaterSettings} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextareaField
          name="officeHours"
          label="Orari dell'ufficio"
          defaultValue={officeHours}
          rows={3}
          placeholder={"Lun-sab 8:30-12:30 e 15:00-18:00\nDomenica chiuso"}
        />
        <TextareaField
          name="boaterInfo"
          label="Informazioni per i diportisti"
          defaultValue={boaterInfo}
          rows={3}
          hint="Servizi, numeri utili, regole principali. Compare nell'area diportista."
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          name="coordinates"
          label="Posizione del porto"
          defaultValue={coordinates}
          placeholder="42.65890, 14.02560"
          hint="Su Google Maps: tasto destro (o tieni premuto) sul porto e copia i numeri."
          wrapperClassName="sm:col-span-2"
        />
        <Field name="windAlertKnots" label="Avviso raffiche oltre (nodi)" defaultValue={String(windAlertKnots)} inputMode="numeric" hint="Burrasca (forza 8) sempre." />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          name="waveAlertM"
          label="Avviso onda oltre (m)"
          defaultValue={String(waveAlertM).replace(".", ",")}
          inputMode="decimal"
          hint="Onda significativa prevista. 2,5 m = mare molto mosso."
        />
        {zoneNames.length > 0 ? (
          <SelectField
            name="alertZone"
            label="Zona di allerta (Protezione Civile)"
            defaultValue={alertZone}
            placeholder={detectedZone ? `Dal Comune del porto: ${detectedZone}` : "Scegli la zona…"}
            options={zoneNames.map((z) => ({ value: z, label: z }))}
            hint={detectedZone ? "Lascia la prima voce per usare la zona del Comune." : "Il Comune del porto non è in nessuna zona: scegli quella giusta."}
            wrapperClassName="sm:col-span-2"
          />
        ) : (
          <>
            <input type="hidden" name="alertZone" value={alertZone} />
            <p className="text-sm text-muted sm:col-span-2">
              Zona di allerta della Protezione Civile: {alertZone || detectedZone || "non ancora individuata"}. L&apos;elenco delle zone non è raggiungibile in questo
              momento.
            </p>
          </>
        )}
      </div>
      <CheckboxField
        name="windAlertAuto"
        label="Invia l'avviso meteo da solo"
        defaultChecked={windAlertAuto}
        hint="Burrasca, raffiche od onda oltre soglia, allerta arancione o rossa della Protezione Civile. Se spento, l'avviso compare in «Meteo» e lo invii tu con un clic. L'invio automatico richiede il controllo periodico (vedi la guida)."
      />
      <FormMessage />
      <Submit>Salva</Submit>
    </Form>
  );
}

export function LegalTextsForm({
  version,
  privacyText,
  contractTerms,
  contractApprovalText,
}: {
  version: string;
  privacyText: string;
  contractTerms: string;
  contractApprovalText: string;
}) {
  return (
    <Form action={saveLegalTexts} className="space-y-4">
      <Field
        name="privacyPolicyVersion"
        label="Versione dell'informativa"
        defaultValue={version}
        required
        wrapperClassName="max-w-40"
        hint="Aumentala quando cambi il testo."
      />
      <TextareaField
        name="privacyPolicyText"
        label="Informativa sul trattamento dei dati"
        defaultValue={privacyText}
        rows={14}
        hint={
          <>
            Puoi usare <code>{"{{titolare}}"}</code>, <code>{"{{indirizzo}}"}</code>, <code>{"{{email}}"}</code> e <code>{"{{porto}}"}</code>: vengono sostituiti con i dati del porto.
          </>
        }
      />
      <div>
        <TextareaField
          name="contractTerms"
          label="Condizioni del contratto (dall'articolo 4)"
          defaultValue={contractTerms}
          rows={14}
          hint="Gli articoli 1-3 (oggetto, canone, spese) li compone l'app con i dati del contratto. Ogni articolo inizia a capo con il suo numero, es. «5)»."
        />
        <RestoreTemplate field="contractTerms" text={CONTRACT_TERMS_TEMPLATE} />
      </div>
      <div>
        <TextareaField
          name="contractApprovalText"
          label="Approvazione specifica delle clausole (artt. 1341-1342 c.c.)"
          defaultValue={contractApprovalText}
          rows={5}
          hint="Stampata dopo le firme, con una seconda firma del cliente. Se cambi la numerazione degli articoli, aggiornala anche qui."
        />
        <RestoreTemplate field="contractApprovalText" text={CONTRACT_APPROVAL_TEMPLATE} />
      </div>
      <div className="flex items-center gap-3">
        <Submit>Salva i testi</Submit>
        <FormMessage />
      </div>
    </Form>
  );
}

export function PierForm({ pier, nextOrder }: { pier?: { id: string; code: string; name: string; sortOrder: number }; nextOrder: number }) {
  return (
    <Form action={savePier} resetOnSuccess={!pier} className="grid grid-cols-1 gap-3 sm:grid-cols-[6rem_1fr_7rem_auto] sm:items-end">
      {pier && <input type="hidden" name="id" value={pier.id} />}
      <Field name="code" label="Sigla" defaultValue={pier?.code ?? ""} maxLength={4} placeholder="A" required />
      <Field name="name" label="Nome" defaultValue={pier?.name ?? ""} placeholder="Pontile A" required />
      <Field name="sortOrder" label="Ordine" defaultValue={pier?.sortOrder ?? nextOrder} inputMode="numeric" />
      <Submit variant={pier ? "secondary" : "primary"}>{pier ? "Salva" : "Aggiungi pontile"}</Submit>
      <div className="sm:col-span-4">
        <FormMessage />
      </div>
    </Form>
  );
}

export function DeletePierButton({ pierId, berthCount }: { pierId: string; berthCount: number }) {
  return (
    <ActionButton
      action={deletePier}
      fields={{ pierId }}
      variant="danger"
      size="sm"
      confirm={berthCount > 0 ? `Eliminare il pontile con i suoi ${berthCount} posti barca?` : "Eliminare questo pontile?"}
    >
      Elimina pontile
    </ActionButton>
  );
}

export function GenerateBerthsForm({
  pierId,
  prefix,
  nextNumber,
  categories,
}: {
  pierId: string;
  prefix: string;
  // Primo numero libero dopo i posti già creati: la numerazione prosegue da lì.
  nextNumber: number;
  categories: { id: string; label: string }[];
}) {
  return (
    <Form action={generateBerths} className="space-y-3">
      <input type="hidden" name="pierId" value={pierId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field name="prefix" label="Prefisso" defaultValue={prefix} maxLength={4} required />
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
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <CheckboxField name="hasWater" label="Acqua" defaultChecked />
        <CheckboxField name="hasPower" label="Corrente" defaultChecked />
      </div>
      <div className="flex items-center gap-3">
        <Submit variant="secondary">Crea i posti</Submit>
        <FormMessage />
      </div>
      <p className="hint">I posti prendono le misure della categoria scelta: potrai modificarli uno per uno. I codici già esistenti vengono saltati.</p>
    </Form>
  );
}

export interface BerthFormValues {
  id: string;
  code: string;
  categoryId: string | null;
  side: "sx" | "dx";
  position: number;
  length: string;
  beam: string;
  draft: string;
  hasWater: boolean;
  hasPower: boolean;
  status: string;
  notes: string | null;
}

export function BerthForm({ berth, categories }: { berth: BerthFormValues; categories: { id: string; label: string }[] }) {
  return (
    <Form action={saveBerth} className="card max-w-3xl space-y-4 p-4">
      <input type="hidden" name="id" value={berth.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field name="code" label="Codice" defaultValue={berth.code} required />
        <SelectField name="categoryId" label="Categoria tariffaria" defaultValue={berth.categoryId ?? ""} placeholder="Nessuna" options={categories.map((c) => ({ value: c.id, label: c.label }))} />
        <SelectField
          name="status"
          label="Stato"
          defaultValue={berth.status}
          options={[
            { value: "attivo", label: "In servizio" },
            { value: "manutenzione", label: "In manutenzione" },
            { value: "fuori_servizio", label: "Fuori servizio" },
          ]}
        />
        <Field name="lengthCm" label="Lunghezza (m)" defaultValue={berth.length} inputMode="decimal" required />
        <Field name="beamCm" label="Larghezza (m)" defaultValue={berth.beam} inputMode="decimal" required />
        <Field name="draftCm" label="Fondale (m)" defaultValue={berth.draft} inputMode="decimal" />
        <SelectField
          name="side"
          label="Lato del pontile"
          defaultValue={berth.side}
          options={[
            { value: "sx", label: "Sinistro (sopra nella mappa)" },
            { value: "dx", label: "Destro (sotto nella mappa)" },
          ]}
        />
        <Field name="position" label="Posizione lungo il pontile" defaultValue={berth.position} inputMode="numeric" hint="0 è il primo posto dalla radice." />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <CheckboxField name="hasWater" label="Acqua" defaultChecked={berth.hasWater} />
        <CheckboxField name="hasPower" label="Corrente" defaultChecked={berth.hasPower} />
      </div>
      <TextareaField name="notes" label="Note" defaultValue={berth.notes ?? ""} rows={2} hint="Es. motivo della manutenzione: compare sulla mappa." />
      <FormMessage />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Submit>Salva</Submit>
          <Link href="/impostazioni/pontili" className="btn btn-ghost">
            Annulla
          </Link>
        </div>
      </div>
    </Form>
  );
}

export function DeleteBerthButton({ berthId }: { berthId: string }) {
  return (
    <ActionButton action={deleteBerth} fields={{ berthId }} variant="danger" size="sm" confirm="Eliminare questo posto barca?">
      Elimina posto
    </ActionButton>
  );
}

export function CategoryForm({ category, nextOrder }: { category?: { id: string; name: string; length: string; beam: string; sortOrder: number }; nextOrder: number }) {
  return (
    <Form action={saveCategory} resetOnSuccess={!category} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem_8rem_6rem_auto] sm:items-end">
      {category && <input type="hidden" name="id" value={category.id} />}
      <Field name="name" label="Nome" defaultValue={category?.name ?? ""} placeholder="Es. VII · fino a 20,00 m" required />
      <Field name="maxLengthCm" label="Lunghezza max (m)" defaultValue={category?.length ?? ""} inputMode="decimal" required />
      <Field name="maxBeamCm" label="Larghezza max (m)" defaultValue={category?.beam ?? ""} inputMode="decimal" required />
      <Field name="sortOrder" label="Ordine" defaultValue={category?.sortOrder ?? nextOrder} inputMode="numeric" />
      <Submit variant={category ? "secondary" : "primary"}>{category ? "Salva" : "Aggiungi"}</Submit>
      <div className="sm:col-span-5">
        <FormMessage />
      </div>
    </Form>
  );
}

export function DeleteCategoryButton({ categoryId }: { categoryId: string }) {
  return (
    <ActionButton action={deleteCategory} fields={{ categoryId }} variant="ghost" size="sm" confirm="Eliminare questa categoria? Verranno eliminate anche le sue tariffe nei listini.">
      Elimina
    </ActionButton>
  );
}

export function AddMemberForm() {
  return (
    <Form action={addMember} resetOnSuccess className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field name="name" label="Nome e cognome" required autoComplete="off" />
        <Field name="email" label="Email" type="email" required autoComplete="off" />
        <SelectField name="role" label="Ruolo" defaultValue="banchina" options={ROLE_OPTIONS} />
        <Field name="password" label="Password provvisoria" type="text" required autoComplete="off" hint="Almeno 10 caratteri." />
      </div>
      <FormMessage />
      <Submit>Aggiungi utente</Submit>
    </Form>
  );
}

export function MemberRoleForm({ membershipId, role }: { membershipId: string; role: string }) {
  return (
    <Form action={changeMemberRole} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="membershipId" value={membershipId} />
      <select name="role" defaultValue={role} aria-label="Ruolo" className="input w-auto py-1 text-sm">
        {ROLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Submit variant="secondary" size="sm">
        Cambia
      </Submit>
      <FormMessage />
    </Form>
  );
}

export function MemberActions({ membershipId, self }: { membershipId: string; self: boolean }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <details>
        <summary className="link cursor-pointer text-sm">Reimposta password</summary>
        <Form action={resetMemberPassword} resetOnSuccess className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="membershipId" value={membershipId} />
          <Field name="password" label="Nuova password" type="text" autoComplete="off" required />
          <Submit variant="secondary" size="sm">
            Imposta
          </Submit>
          <div className="w-full">
            <FormMessage />
          </div>
        </Form>
      </details>
      {!self && (
        <ActionButton action={removeMember} fields={{ membershipId }} variant="ghost" size="sm" confirm="Togliere a questa persona l'accesso al porto?">
          Rimuovi
        </ActionButton>
      )}
    </div>
  );
}

export function OwnPasswordForm() {
  return (
    <Form action={changeOwnPassword} resetOnSuccess className="max-w-sm space-y-3">
      <Field name="current" label="Password attuale" type="password" autoComplete="current-password" required />
      <Field name="password" label="Nuova password" type="password" autoComplete="new-password" required hint="Almeno 10 caratteri." />
      <FormMessage />
      <Submit>Cambia password</Submit>
    </Form>
  );
}
