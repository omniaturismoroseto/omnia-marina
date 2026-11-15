"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionButton, Field, Form, FormMessage, SelectField, Submit, TextareaField } from "@/components/form";
import { formatMoney, moneyInput } from "@/lib/format";
import { LEDGER_CATEGORIES } from "@/lib/labels";
import { addPayment, cancelCharge, deleteLedgerEntry, removePayment, saveCharge, saveLedgerEntry } from "@/server/accounting-actions";

const METHODS = [
  { value: "bonifico", label: "Bonifico" },
  { value: "pos", label: "POS / carta" },
  { value: "contanti", label: "Contanti" },
  { value: "assegno", label: "Assegno" },
  { value: "altro", label: "Altro" },
];

export function ChargeForm({
  owners,
  contracts,
  today,
  defaultVatRate,
  initialOwnerId,
  extras,
}: {
  owners: { id: string; name: string }[];
  contracts: { id: string; ownerId: string; label: string }[];
  today: string;
  defaultVatRate: number;
  initialOwnerId: string;
  extras: { id: string; name: string; amountCents: number; vatRate: number }[];
}) {
  const [ownerId, setOwnerId] = useState(initialOwnerId);
  const [kind, setKind] = useState("servizi");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [vatRate, setVatRate] = useState(String(defaultVatRate));

  // Una voce del listino compila descrizione, importo e IVA; le cauzioni (senza IVA) vanno in "Altro".
  function pickExtra(id: string) {
    const extra = extras.find((e) => e.id === id);
    if (!extra) return;
    setDescription(extra.name);
    setAmount(moneyInput(extra.amountCents));
    setVatRate(String(extra.vatRate));
    setKind(extra.vatRate === 0 ? "altro" : "servizi");
  }
  const ownerContracts = contracts.filter((c) => c.ownerId === ownerId);
  return (
    <Form action={saveCharge} className="card max-w-3xl space-y-4 p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {extras.length > 0 && (
          <SelectField
            name="extraId"
            label="Voce del listino"
            defaultValue=""
            onChange={(e) => pickExtra(e.target.value)}
            placeholder="Nessuna, compilo a mano"
            options={extras.map((e) => ({ value: e.id, label: `${e.name} · ${formatMoney(e.amountCents)}` }))}
            hint="Compila descrizione, importo e IVA; restano modificabili."
            wrapperClassName="sm:col-span-2"
          />
        )}
        <SelectField
          name="ownerId"
          label="Cliente"
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          placeholder="Scegli il cliente…"
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
          required
        />
        <SelectField
          name="contractId"
          label="Contratto collegato"
          defaultValue=""
          placeholder="Nessuno"
          options={ownerContracts.map((c) => ({ value: c.id, label: c.label }))}
          hint="Facoltativo."
        />
        <SelectField
          name="kind"
          label="Tipo"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          options={[
            { value: "servizi", label: "Servizi (alaggio, varo, assistenza…)" },
            { value: "utenze", label: "Utenze (acqua, corrente)" },
            { value: "ormeggio", label: "Ormeggio" },
            { value: "altro", label: "Altro" },
          ]}
        />
        <Field name="description" label="Descrizione" placeholder="Es. Alaggio e varo con gru" value={description} onChange={(e) => setDescription(e.target.value)} required />
        <Field name="issueDate" label="Data dell'addebito" type="date" defaultValue={today} required />
        <Field name="dueDate" label="Scadenza del pagamento" type="date" defaultValue={today} required />
        <Field name="amount" label="Importo (IVA inclusa)" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <SelectField
          name="vatRate"
          label="Aliquota IVA"
          value={vatRate}
          onChange={(e) => setVatRate(e.target.value)}
          options={[22, 10, 5, 4, 0].map((r) => ({ value: String(r), label: `${r}%` }))}
        />
      </div>
      <TextareaField name="notes" label="Note interne" rows={2} />
      <FormMessage />
      <div className="flex gap-2">
        <Submit>Crea addebito</Submit>
        <Link href="/contabilita" className="btn btn-ghost">
          Annulla
        </Link>
      </div>
    </Form>
  );
}

export function PaymentForm({ chargeId, today, residual }: { chargeId: string; today: string; residual: string }) {
  return (
    <Form action={addPayment} className="space-y-3">
      <input type="hidden" name="chargeId" value={chargeId} />
      <Field name="amount" label="Importo incassato" defaultValue={residual} inputMode="decimal" required hint="Per un acconto, indica solo la parte incassata." />
      <Field name="paidOn" label="Data dell'incasso" type="date" defaultValue={today} max={today} required />
      <SelectField name="method" label="Metodo" defaultValue="bonifico" options={METHODS} hint="I contanti vanno in cassa, gli altri metodi in banca." />
      <Field name="reference" label="Riferimento" placeholder="Es. CRO, numero ricevuta" />
      <FormMessage />
      <Submit className="w-full">Registra incasso</Submit>
    </Form>
  );
}

export function RemovePaymentButton({ paymentId }: { paymentId: string }) {
  return (
    <ActionButton action={removePayment} fields={{ paymentId }} variant="ghost" size="sm" confirm="Stornare questo incasso? Verrà tolto anche dalla prima nota.">
      Storna
    </ActionButton>
  );
}

export function CancelChargeButton({ chargeId }: { chargeId: string }) {
  return (
    <ActionButton action={cancelCharge} fields={{ chargeId }} variant="danger" size="sm" confirm="Annullare questo addebito? Non sarà più da incassare.">
      Annulla addebito
    </ActionButton>
  );
}

export function LedgerEntryForm({ today }: { today: string }) {
  const [direction, setDirection] = useState<"entrata" | "uscita">("uscita");
  return (
    <Form action={saveLedgerEntry} resetOnSuccess className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          name="direction"
          label="Tipo"
          value={direction}
          onChange={(e) => setDirection(e.target.value as "entrata" | "uscita")}
          options={[
            { value: "uscita", label: "Uscita" },
            { value: "entrata", label: "Entrata" },
          ]}
        />
        <Field name="entryDate" label="Data" type="date" defaultValue={today} required />
        <Field name="amount" label="Importo" inputMode="decimal" placeholder="0,00" required />
        <SelectField
          name="account"
          label="Conto"
          defaultValue="banca"
          options={[
            { value: "banca", label: "Banca" },
            { value: "cassa", label: "Cassa" },
          ]}
        />
        {/* key: al cambio di tipo l'elenco delle categorie riparte dalla prima voce */}
        <SelectField key={direction} name="category" label="Categoria" options={LEDGER_CATEGORIES[direction].map((c) => ({ value: c, label: c }))} />
        <Field name="description" label="Descrizione" required wrapperClassName="lg:col-span-3" />
        <Field name="counterparty" label={direction === "uscita" ? "Fornitore / beneficiario" : "Ricevuto da"} wrapperClassName="sm:col-span-1 lg:col-span-2" />
        <Field name="documentRef" label="Documento" placeholder="Es. fattura n. 12" wrapperClassName="lg:col-span-2" />
      </div>
      <FormMessage />
      <Submit>Registra movimento</Submit>
      {direction === "entrata" && <p className="hint">Gli incassi dei clienti si registrano dall&apos;addebito: qui vanno solo le altre entrate.</p>}
    </Form>
  );
}

export function DeleteLedgerEntryButton({ entryId }: { entryId: string }) {
  return (
    <ActionButton action={deleteLedgerEntry} fields={{ entryId }} variant="ghost" size="sm" confirm="Eliminare questo movimento?">
      Elimina
    </ActionButton>
  );
}
