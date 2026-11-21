"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Field, Form, FormMessage, SelectField, Submit, TextareaField } from "@/components/form";
import { addDays, addMonths, formatDate, isValidISODate } from "@/lib/dates";
import { formatMoney, moneyInput, parseMoney } from "@/lib/format";
import { splitInstalments } from "@/lib/pricing";
import { loadContractOptions, saveContract, saveDraftContract, type ContractOptions } from "@/server/contract-actions";
import { ContractExtras, feeInput } from "./contract-extras";

type ContractType = "annuale" | "stagionale" | "mensile" | "transito";

const TYPE_OPTIONS: { value: ContractType; label: string }[] = [
  { value: "annuale", label: "Annuale" },
  { value: "stagionale", label: "Stagionale" },
  { value: "mensile", label: "Mensile" },
  { value: "transito", label: "Transito" },
];

// Data di fine proposta quando si sceglie il tipo di contratto.
function suggestedEnd(type: ContractType, start: string): string {
  if (type === "transito") return addDays(start, 1);
  const months = type === "annuale" ? 12 : type === "stagionale" ? 6 : 1;
  return addDays(addMonths(start, months), -1);
}

export function ContractForm({
  owners,
  boats,
  today,
  defaultVatRate,
  fees,
  initial,
  draft,
}: {
  owners: { id: string; name: string }[];
  boats: { id: string; ownerId: string; name: string; size: string }[];
  today: string;
  defaultVatRate: number;
  // Spese di gestione e quota rifiuti predefinite del porto, proposte nei contratti annuali.
  fees: { gestione: number | null; rifiuti: number | null };
  initial: { ownerId: string; boatId: string; berthId: string; startDate: string; type: ContractType };
  // Modifica di una bozza: valori salvati. Rate, scadenze e voci aggiuntive restano fuori (si decidono all'attivazione
  // e dalla scheda del contratto).
  draft?: { contractId: string; endDate: string; amountCents: number; vatRate: number; signedOn: string | null; notes: string | null };
}) {
  const [ownerId, setOwnerId] = useState(initial.ownerId);
  const [boatId, setBoatId] = useState(initial.boatId);
  const [type, setType] = useState<ContractType>(initial.type);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(draft?.endDate ?? suggestedEnd(initial.type, initial.startDate));
  const [berthId, setBerthId] = useState(initial.berthId);
  const [amount, setAmount] = useState(draft ? moneyInput(draft.amountCents) : "");
  // In una bozza l'importo salvato vale come scritto a mano: il listino non lo sovrascrive.
  const [amountEdited, setAmountEdited] = useState(Boolean(draft));
  const [instalments, setInstalments] = useState(1);
  const [everyMonths, setEveryMonths] = useState(1);
  const [firstDue, setFirstDue] = useState(initial.startDate);
  const [firstDueEdited, setFirstDueEdited] = useState(false);
  const annualFees = (t: ContractType) => (t === "annuale" ? { gestione: feeInput(fees.gestione), rifiuti: feeInput(fees.rifiuti) } : { gestione: "", rifiuti: "" });
  const [gestione, setGestione] = useState(() => annualFees(initial.type).gestione);
  const [rifiuti, setRifiuti] = useState(() => annualFees(initial.type).rifiuti);
  const [feesEdited, setFeesEdited] = useState(false);
  // Come per l'importo: una quota rifiuti scritta a mano non va sovrascritta da quella del listino.
  const feesEditedRef = useRef(false);
  const [spacesCents, setSpacesCents] = useState(0);
  // Ultima risposta del server, con la richiesta a cui si riferisce.
  const [result, setResult] = useState<{ request: object; options: ContractOptions } | null>(null);
  // Serve dentro la risposta asincrona: un importo scritto a mano non va sovrascritto dal listino.
  const amountEditedRef = useRef(Boolean(draft));

  const ownerBoats = useMemo(() => boats.filter((b) => b.ownerId === ownerId), [boats, ownerId]);
  const datesValid = isValidISODate(startDate) && isValidISODate(endDate) && endDate >= startDate;

  // Posti liberi e preventivo si ricalcolano quando cambiano barca, tipo, date o posto.
  const request = useMemo(
    () => (boatId && datesValid ? { boatId, type, startDate, endDate, berthId: berthId || null } : null),
    [boatId, type, startDate, endDate, berthId, datesValid],
  );
  const options = request ? (result?.options ?? null) : null;
  const loading = request !== null && result?.request !== request;

  useEffect(() => {
    if (!request) return;
    let superseded = false;
    loadContractOptions(request)
      .then((next) => {
        if (superseded) return; // risposta superata da una richiesta più recente
        setResult({ request, options: next });
        if (!amountEditedRef.current && next.quote) setAmount(moneyInput(next.quote.totalCents));
        // La quota rifiuti del listino (per categoria e zona) prende il posto di quella generale del porto.
        if (!feesEditedRef.current && next.quote?.wasteCents) setRifiuti(moneyInput(next.quote.wasteCents));
        if (request.berthId && !next.berths.some((b) => b.id === request.berthId && b.available)) setBerthId("");
      })
      .catch(() => {
        if (!superseded) setResult({ request, options: { berths: [], quote: null, quoteNote: "Impossibile verificare la disponibilità: riprova.", itemPrices: {}, listExtras: [] } });
      });
    return () => {
      superseded = true;
    };
  }, [request]);

  function markAmountEdited(edited: boolean) {
    amountEditedRef.current = edited;
    setAmountEdited(edited);
  }

  function changeOwner(id: string) {
    setOwnerId(id);
    const list = boats.filter((b) => b.ownerId === id);
    setBoatId(list.length === 1 ? list[0].id : "");
  }

  function changeType(next: ContractType) {
    setType(next);
    if (!feesEdited) {
      const proposed = annualFees(next);
      setGestione(proposed.gestione);
      setRifiuti(proposed.rifiuti);
    }
    if (isValidISODate(startDate)) setEndDate(suggestedEnd(next, startDate));
    markAmountEdited(false);
  }

  function changeStart(next: string) {
    setStartDate(next);
    if (isValidISODate(next)) {
      setEndDate(suggestedEnd(type, next));
      if (!firstDueEdited) setFirstDue(next);
    }
    markAmountEdited(false);
  }

  const amountCents = parseMoney(amount);
  const extrasCents = spacesCents + (parseMoney(gestione) ?? 0) + (parseMoney(rifiuti) ?? 0);
  const plan = amountCents && amountCents > 0 && isValidISODate(firstDue) ? splitInstalments(amountCents, instalments, firstDue, everyMonths) : [];
  const availableBerths = options?.berths.filter((b) => b.available) ?? [];
  const unavailableBerths = options?.berths.filter((b) => !b.available) ?? [];
  const piersInOrder = [...new Set(availableBerths.map((b) => b.pierName))];

  return (
    <Form action={draft ? saveDraftContract : saveContract} className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
      {draft && <input type="hidden" name="contractId" value={draft.contractId} />}
      <div className="space-y-5">
        <fieldset className="card p-4">
          <legend className="float-left mb-3 w-full text-[15px] font-semibold text-ink">Cliente e barca</legend>
          <div className="clear-both grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              name="ownerId"
              label="Cliente"
              value={ownerId}
              onChange={(e) => changeOwner(e.target.value)}
              placeholder="Scegli il cliente…"
              options={owners.map((o) => ({ value: o.id, label: o.name }))}
              required
            />
            <SelectField
              name="boatId"
              label="Barca"
              value={boatId}
              onChange={(e) => {
                setBoatId(e.target.value);
                markAmountEdited(false);
              }}
              placeholder={ownerId ? (ownerBoats.length ? "Scegli la barca…" : "Nessuna barca registrata") : "Scegli prima il cliente"}
              options={ownerBoats.map((b) => ({ value: b.id, label: `${b.name} · ${b.size}` }))}
              disabled={!ownerId}
              hint={
                ownerId && ownerBoats.length === 0 ? (
                  <Link href={`/barche/nuova?cliente=${ownerId}`} className="link">
                    Aggiungi la barca del cliente
                  </Link>
                ) : undefined
              }
              required
            />
          </div>
        </fieldset>

        <fieldset className="card p-4">
          <legend className="float-left mb-3 w-full text-[15px] font-semibold text-ink">Periodo e posto</legend>
          <div className="clear-both grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SelectField name="type" label="Tipo di contratto" value={type} onChange={(e) => changeType(e.target.value as ContractType)} options={TYPE_OPTIONS} />
            <Field name="startDate" label={type === "transito" ? "Arrivo" : "Inizio"} type="date" value={startDate} onChange={(e) => changeStart(e.target.value)} required />
            <Field
              name="endDate"
              label={type === "transito" ? "Partenza" : "Fine (ultimo giorno)"}
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                markAmountEdited(false);
              }}
              required
            />
          </div>

          <div className="mt-4">
            <label htmlFor="berthId" className="label">
              Posto barca
            </label>
            <select id="berthId" name="berthId" className="input" value={berthId} onChange={(e) => setBerthId(e.target.value)} disabled={!options}>
              <option value="">{options ? "Da assegnare in seguito (solo bozza)" : "Scegli barca e date per vedere i posti liberi"}</option>
              {piersInOrder.map((pier) => (
                <optgroup key={pier} label={pier}>
                  {availableBerths
                    .filter((b) => b.pierName === pier)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} · {b.size}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <p className="hint">
              {loading
                ? "Verifico la disponibilità…"
                : options
                  ? `${availableBerths.length} posti liberi e adatti alla barca nel periodo` +
                    (unavailableBerths.length ? ` · ${unavailableBerths.length} non disponibili (occupati, troppo piccoli o fuori servizio).` : ".")
                  : "L'elenco mostra solo i posti liberi nel periodo e abbastanza grandi per la barca."}
            </p>
          </div>
        </fieldset>

        <fieldset className="card p-4">
          <legend className="float-left mb-3 w-full text-[15px] font-semibold text-ink">{draft ? "Importo" : "Importo e rate"}</legend>
          <div className="clear-both grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              name="amount"
              label="Canone posto barca (IVA inclusa)"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                markAmountEdited(true);
              }}
              inputMode="decimal"
              placeholder="0,00"
              required
              hint={amountEdited && options?.quote ? `Da listino: ${formatMoney(options.quote.totalCents)}` : "Proposto dal listino, modificabile."}
            />
            <SelectField
              name="vatRate"
              label="Aliquota IVA"
              defaultValue={String(draft?.vatRate ?? defaultVatRate)}
              options={[22, 10, 5, 4, 0].map((r) => ({ value: String(r), label: `${r}%` }))}
            />
            <Field name="signedOn" label="Firmato il" type="date" defaultValue={draft?.signedOn ?? ""} hint="Lascia vuoto se non ancora firmato." />
            {!draft && (
              <>
                <SelectField
                  name="instalments"
                  label="Numero di rate"
                  value={String(instalments)}
                  onChange={(e) => setInstalments(Number(e.target.value))}
                  options={[1, 2, 3, 4, 6, 12].map((n) => ({ value: String(n), label: n === 1 ? "Unica soluzione" : `${n} rate` }))}
                />
                <Field
                  name="firstDueDate"
                  label={instalments === 1 ? "Scadenza del pagamento" : "Scadenza della prima rata"}
                  type="date"
                  value={firstDue}
                  onChange={(e) => {
                    setFirstDue(e.target.value);
                    setFirstDueEdited(true);
                  }}
                  required
                />
                {instalments > 1 ? (
                  <SelectField
                    name="everyMonths"
                    label="Cadenza"
                    value={String(everyMonths)}
                    onChange={(e) => setEveryMonths(Number(e.target.value))}
                    options={[1, 2, 3, 4, 6].map((n) => ({ value: String(n), label: n === 1 ? "Ogni mese" : `Ogni ${n} mesi` }))}
                  />
                ) : (
                  <input type="hidden" name="everyMonths" value="1" />
                )}
              </>
            )}
          </div>
          {!draft && plan.length > 1 && (
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              {plan.map((p) => (
                <li key={p.index} className="tabular-nums">
                  {formatDate(p.dueDate)}: <span className="font-medium text-ink">{formatMoney(p.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        {!draft && (
          <ContractExtras
            startDate={startDate}
            endDate={endDate}
            gestione={gestione}
            rifiuti={rifiuti}
            onGestione={(v) => {
              setGestione(v);
              setFeesEdited(true);
              feesEditedRef.current = true;
            }}
            onRifiuti={(v) => {
              setRifiuti(v);
              setFeesEdited(true);
              feesEditedRef.current = true;
            }}
            onSpacesTotal={setSpacesCents}
            prices={options?.itemPrices ?? {}}
            listExtras={options?.listExtras ?? []}
            listReady={options !== null}
            annualDefault={type === "annuale"}
          />
        )}
        {!draft && extrasCents > 0 && (
          <p className="-mt-2 text-sm text-muted">
            Totale del contratto: <strong className="text-ink tabular-nums">{formatMoney((amountCents ?? 0) + extrasCents)}</strong> (posto barca{" "}
            {formatMoney(amountCents ?? 0)} + altre voci {formatMoney(extrasCents)}).
          </p>
        )}

        <fieldset className="card p-4">
          <legend className="float-left mb-3 w-full text-[15px] font-semibold text-ink">Note</legend>
          <TextareaField
            name="notes"
            label="Note per ufficio e banchina"
            rows={2}
            wrapperClassName="clear-both"
            defaultValue={draft?.notes ?? ""}
            placeholder="Es. orario di arrivo previsto, richieste particolari"
          />
        </fieldset>

        <FormMessage />
        <div className="flex flex-wrap gap-2">
          {draft ? (
            <>
              <Submit>Salva modifiche</Submit>
              <Link href={`/contratti/${draft.contractId}`} className="btn btn-ghost">
                Annulla
              </Link>
            </>
          ) : (
            <>
              <Submit name="intent" value="attivo">
                Salva e attiva
              </Submit>
              <Submit name="intent" value="bozza" variant="secondary">
                Salva come bozza
              </Submit>
              <Link href="/contratti" className="btn btn-ghost">
                Annulla
              </Link>
            </>
          )}
        </div>
        <p className="text-sm text-muted">
          Attivando il contratto il posto viene impegnato e nascono gli addebiti delle rate. La bozza non impegna il posto{startDate > today ? "" : " e non compare in banchina"}.
        </p>
      </div>

      <aside className="card p-4 lg:sticky lg:top-6" aria-live="polite">
        <h2 className="text-[15px] font-semibold text-ink">Preventivo da listino</h2>
        {!options ? (
          <p className="mt-2 text-sm text-muted">Scegli barca e date per calcolare l&apos;importo.</p>
        ) : options.quote ? (
          <>
            <p className="mt-1 text-xs text-muted">
              {options.quote.listName} · categoria {options.quote.categoryName}
              {options.quote.pierName ? ` · tariffa di ${options.quote.pierName}` : ""}
            </p>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {options.quote.lines.map((line) => (
                  <tr key={line.label} className="border-b border-line-soft">
                    <td className="py-1.5 pr-2">
                      {line.quantity} × {line.label.charAt(0).toLowerCase() + line.label.slice(1)}
                      <span className="block text-xs text-muted">{formatMoney(line.unitCents)} cad.</span>
                    </td>
                    <td className="py-1.5 text-right align-top tabular-nums">{formatMoney(line.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-2 font-semibold">Totale IVA inclusa</td>
                  <td className="pt-2 text-right text-xl font-semibold tabular-nums">{formatMoney(options.quote.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
            {options.quote.wasteCents > 0 && (
              <p className="mt-2 text-xs text-muted">Quota rifiuti da listino: {formatMoney(options.quote.wasteCents)}, proposta tra le altre voci del contratto.</p>
            )}
            {options.quoteNote && <p className="mt-2 rounded-md bg-warn-soft px-2 py-1.5 text-xs text-warn">{options.quoteNote}</p>}
            {amountEdited && amountCents !== options.quote.totalCents && (
              <button
                type="button"
                className="link mt-3 text-sm"
                onClick={() => {
                  setAmount(moneyInput(options.quote!.totalCents));
                  markAmountEdited(false);
                }}
              >
                Usa l&apos;importo di listino
              </button>
            )}
          </>
        ) : (
          <p className="mt-2 rounded-md bg-warn-soft px-2 py-1.5 text-sm text-warn">{options.quoteNote}</p>
        )}
      </aside>
    </Form>
  );
}
