"use client";

import { useState } from "react";
import { ActionButton, Field, Form, FormMessage, SelectField, Submit, TextareaField } from "@/components/form";
import { itemHasPeriod, ITEM_KINDS, SERVICE_ITEM_KIND, SERVICE_VAT_RATES } from "@/lib/contract-items";
import { annualEnd, isValidISODate } from "@/lib/dates";
import { formatMoney, moneyInput } from "@/lib/format";
import { CONTRACT_ITEM_LABEL } from "@/lib/labels";
import type { ListExtra } from "@/server/list-extras";
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

const VAT_OPTIONS = SERVICE_VAT_RATES.map((r) => ({ value: String(r), label: r === 0 ? "Senza IVA (cauzione)" : `${r}%` }));

export function AddContractItemForm({
  contractId,
  startDate,
  endDate,
  active,
  listExtras,
  annualDefault,
}: {
  contractId: string;
  startDate: string;
  endDate: string;
  active: boolean;
  // Contratto annuale: gli spazi nascono con «Annuale» spuntato.
  annualDefault: boolean;
  // Servizi e cauzioni del listino in vigore all'inizio del contratto: sceglierne uno compila voce e importo.
  listExtras: ListExtra[];
}) {
  const [kind, setKind] = useState<(typeof ITEM_KINDS)[number]>("auto_coperto");
  const [picked, setPicked] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [vatRate, setVatRate] = useState("22");
  const [annual, setAnnual] = useState(annualDefault);
  const [from, setFrom] = useState(startDate);
  const [to, setTo] = useState(annualDefault ? annualEnd(startDate) : endDate);
  const period = itemHasPeriod(kind);

  function changeFrom(value: string) {
    setFrom(value);
    if (annual && isValidISODate(value)) setTo(annualEnd(value));
  }

  function changeAnnual(on: boolean) {
    setAnnual(on);
    if (on && isValidISODate(from)) setTo(annualEnd(from));
  }

  function pick(extraId: string) {
    setPicked(extraId);
    const extra = listExtras.find((e) => e.id === extraId);
    if (!extra) return;
    setKind(extra.itemKind ?? SERVICE_ITEM_KIND);
    setAmount(moneyInput(extra.amountCents));
    setDescription(extra.itemKind ? "" : extra.name);
    setVatRate(String(extra.vatRate));
  }

  function reset() {
    setKind("auto_coperto");
    setPicked("");
    setAmount("");
    setDescription("");
    setVatRate("22");
    setAnnual(annualDefault);
    setFrom(startDate);
    setTo(annualDefault ? annualEnd(startDate) : endDate);
  }

  // Dopo un salvataggio riuscito il modulo si svuota: anche le scelte tornano quelle iniziali.
  return (
    <div onReset={reset}>
      <Form action={addContractItemAction} resetOnSuccess className="space-y-3">
        <input type="hidden" name="contractId" value={contractId} />
        {listExtras.length > 0 && (
          <SelectField
            name="fromList"
            label="Dal listino"
            value={picked}
            onChange={(e) => pick(e.target.value)}
            placeholder="Scegli un servizio o una cauzione…"
            options={listExtras.map((e) => ({ value: e.id, label: `${e.name} · ${formatMoney(e.amountCents)}${e.vatRate === 0 ? " (senza IVA)" : ""}` }))}
            hint="Compila voce e importo con il prezzo del listino; puoi sempre cambiarli."
          />
        )}
        <SelectField
          name="kind"
          label="Voce"
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof ITEM_KINDS)[number])}
          options={ITEM_KINDS.map((k) => ({ value: k, label: CONTRACT_ITEM_LABEL[k] }))}
        />
        {kind === SERVICE_ITEM_KIND && (
          <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-3">
            <Field name="description" label="Descrizione" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Es. Cauzione badge" required />
            <SelectField name="vatRate" label="IVA" value={vatRate} onChange={(e) => setVatRate(e.target.value)} options={VAT_OPTIONS} />
          </div>
        )}
        {period && (
          <>
            {(kind === "auto_coperto" || kind === "auto_scoperto") && <Field name="reference" label="Numero del posto auto" />}
            <div className="grid grid-cols-2 gap-3">
              <Field name="startDate" label="Dal" type="date" value={from} onChange={(e) => changeFrom(e.target.value)} required />
              <Field name="endDate" label="Al" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} readOnly={annual} required />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="annual" checked={annual} onChange={(e) => changeAnnual(e.target.checked)} />
              Annuale <span className="text-muted">(un anno intero dalla data di inizio)</span>
            </label>
          </>
        )}
        <Field
          name="amount"
          label={kind === SERVICE_ITEM_KIND && vatRate === "0" ? "Importo" : "Importo (IVA inclusa)"}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          required
          hint={active ? "L'addebito nasce subito, con scadenza oggi." : "L'addebito nasce all'attivazione."}
        />
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
