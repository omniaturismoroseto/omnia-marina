"use client";

import { useRef, useState } from "react";
import { Check, Plus, X } from "@/components/icons";
import { Field } from "@/components/form";
import { annualEnd, isValidISODate } from "@/lib/dates";
import { formatMoney, moneyInput, parseMoney } from "@/lib/format";
import { CONTRACT_ITEM_LABEL } from "@/lib/labels";
import { SPACE_ITEM_KINDS } from "@/lib/contract-items";
import type { ListExtra } from "@/server/list-extras";

type SpaceKind = (typeof SPACE_ITEM_KINDS)[number];
// fromList: nome della voce del listino scelta, mostrato sotto l'importo al posto del prezzo generico.
// annual: spazio per l'anno solare (fino al 31 dicembre); la fine si calcola e non si modifica.
type SpaceState = { on: boolean; annual: boolean; ref: string; from: string; to: string; amount: string; fromList?: string };
type ServiceLine = { key: number; desc: string; amount: string; vatRate: number };

const vatLabel = (rate: number) => (rate === 0 ? "senza IVA" : `IVA ${rate}% inclusa`);

const HAS_REFERENCE: Record<SpaceKind, boolean> = { secca: false, auto_coperto: true, auto_scoperto: true, carrello: false };

/**
 * Voci del contratto oltre al posto barca: spazi a terra, posti auto e carrello (con periodo e importo)
 * e le spese fisse di gestione e rifiuti. I campi si chiamano <tipo>_on, _annual, _ref, _from, _to, _amount.
 * Dal listino si aggiungono anche cauzioni e altri servizi, con il loro prezzo e la loro IVA: campi ripetuti
 * servizio_desc, servizio_amount, servizio_vat.
 */
export function ContractExtras({
  startDate,
  endDate,
  gestione,
  rifiuti,
  onGestione,
  onRifiuti,
  onSpacesTotal,
  prices,
  listExtras,
  listName,
  listReady,
  annualDefault,
}: {
  startDate: string;
  endDate: string;
  gestione: string;
  rifiuti: string;
  onGestione: (value: string) => void;
  onRifiuti: (value: string) => void;
  onSpacesTotal: (cents: number) => void;
  // Importi del listino per le voci, proposti quando si spunta la casella.
  prices: Partial<Record<SpaceKind, number>>;
  // Servizi e cauzioni del listino in vigore alla data di inizio (listName; null se nessun listino la copre); listReady: data valida.
  listExtras: ListExtra[];
  listName: string | null;
  listReady: boolean;
  // Contratto annuale: gli spazi aggiunti nascono già con «Annuale» spuntato.
  annualDefault: boolean;
}) {
  const [spaces, setSpaces] = useState<Record<SpaceKind, SpaceState>>(
    () => Object.fromEntries(SPACE_ITEM_KINDS.map((k) => [k, { on: false, annual: false, ref: "", from: "", to: "", amount: "" }])) as Record<SpaceKind, SpaceState>,
  );
  const [services, setServices] = useState<ServiceLine[]>([]);
  // Chiave delle righe di servizio aggiunte (un contatore: basta che sia diversa per ogni riga).
  const nextKey = useRef(0);

  function changed(nextSpaces: Record<SpaceKind, SpaceState>, nextServices: ServiceLine[]) {
    onSpacesTotal(spacesTotal(nextSpaces) + nextServices.reduce((sum, l) => sum + (parseMoney(l.amount) ?? 0), 0));
  }

  function setServiceLines(next: ServiceLine[]) {
    setServices(next);
    changed(spaces, next);
  }

  // Una voce del listino: un posto auto, il carrello o lo spazio a terra compilano la loro casella con quel prezzo;
  // cauzioni e altri servizi diventano una riga di servizio.
  function addFromList(extraId: string) {
    const extra = listExtras.find((e) => e.id === extraId);
    if (!extra) return;
    if (extra.itemKind) {
      const kind = extra.itemKind;
      const s = spaces[kind];
      update(kind, { ...turnOn(s), amount: moneyInput(extra.amountCents), fromList: extra.name });
    } else {
      setServiceLines([...services, { key: ++nextKey.current, desc: extra.name, amount: moneyInput(extra.amountCents), vatRate: extra.vatRate }]);
    }
  }

  // Accende uno spazio con il periodo del contratto, o fino al 31 dicembre se il contratto è annuale.
  function turnOn(s: SpaceState): Partial<SpaceState> {
    if (s.on) return {};
    const from = s.from || startDate;
    const annual = annualDefault;
    return { on: true, annual, from, to: annual && isValidISODate(from) ? annualEnd(from) : s.to || endDate };
  }

  function update(kind: SpaceKind, patch: Partial<SpaceState>) {
    const next = { ...spaces, [kind]: { ...spaces[kind], ...patch } };
    setSpaces(next);
    changed(next, services);
  }

  return (
    <fieldset className="card p-4">
      <legend className="float-left mb-3 w-full text-[15px] font-semibold text-ink">Altri spazi e spese</legend>
      <div className="clear-both space-y-3">
        <div className="rounded-md bg-paper p-3">
          <p className="label">Servizi e cauzioni{listName ? ` · ${listName}` : ""}</p>
          {!listReady ? (
            <p className="text-sm text-muted">Indica la data di inizio: qui compaiono servizi e cauzioni del listino in vigore.</p>
          ) : !listName ? (
            <p className="text-sm text-muted">Nessun listino copre la data di inizio: servizi e cauzioni si scelgono dal listino in vigore in Tariffe.</p>
          ) : listExtras.length === 0 ? (
            <p className="text-sm text-muted">Il listino non ha servizi né cauzioni: si aggiungono in Tariffe → Servizi e cauzioni.</p>
          ) : (
            // Un pulsante per voce: toccandolo si aggiunge al contratto (posti auto, carrello e spazio a terra accendono la loro casella).
            <div className="flex flex-wrap gap-2" role="group" aria-label="Aggiungi dal listino">
              {listExtras.map((e) => {
                const added = e.itemKind ? spaces[e.itemKind].on : services.some((l) => l.desc === e.name);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => addFromList(e.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                      added ? "border-sea bg-sea-soft text-sea-dark" : "border-line bg-card text-ink hover:border-sea"
                    }`}
                  >
                    {added ? <Check size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
                    <span className="font-medium">{e.name}</span>
                    <span className="text-muted tabular-nums">
                      {formatMoney(e.amountCents)} · {vatLabel(e.vatRate)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {services.length > 0 && (
          <ul className="space-y-2" aria-label="Servizi e cauzioni del contratto">
            {services.map((line, i) => (
              <li key={line.key} className="grid grid-cols-[minmax(0,1fr)_10.5rem_auto] items-end gap-2 rounded-md border border-line-soft p-3">
                <Field
                  name="servizio_desc"
                  label={i === 0 ? "Servizio" : `Servizio ${i + 1}`}
                  value={line.desc}
                  onChange={(e) => setServiceLines(services.map((l) => (l.key === line.key ? { ...l, desc: e.target.value } : l)))}
                  required
                />
                <Field
                  name="servizio_amount"
                  label={line.vatRate === 0 ? "Importo (senza IVA)" : `Importo (IVA ${line.vatRate}% incl.)`}
                  value={line.amount}
                  onChange={(e) => setServiceLines(services.map((l) => (l.key === line.key ? { ...l, amount: e.target.value } : l)))}
                  inputMode="decimal"
                  required
                />
                <input type="hidden" name="servizio_vat" value={line.vatRate} />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mb-1"
                  aria-label={`Togli ${line.desc || "servizio"}`}
                  onClick={() => setServiceLines(services.filter((l) => l.key !== line.key))}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {SPACE_ITEM_KINDS.map((kind) => {
          const s = spaces[kind];
          return (
            <div key={kind} className="rounded-md border border-line-soft p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  name={`${kind}_on`}
                  checked={s.on}
                  onChange={(e) =>
                    update(
                      kind,
                      e.target.checked
                        ? { ...turnOn(s), amount: s.amount || (prices[kind] ? moneyInput(prices[kind]) : "") }
                        : { on: false },
                    )
                  }
                />
                {CONTRACT_ITEM_LABEL[kind]}
              </label>
              {s.on && (
                <div className={`mt-3 grid grid-cols-1 gap-3 ${HAS_REFERENCE[kind] ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
                  {HAS_REFERENCE[kind] && <Field name={`${kind}_ref`} label="Numero" value={s.ref} onChange={(e) => update(kind, { ref: e.target.value })} />}
                  <Field
                    name={`${kind}_from`}
                    label="Dal"
                    type="date"
                    value={s.from}
                    onChange={(e) => update(kind, s.annual && isValidISODate(e.target.value) ? { from: e.target.value, to: annualEnd(e.target.value) } : { from: e.target.value })}
                    required
                  />
                  <Field
                    name={`${kind}_to`}
                    label="Al"
                    type="date"
                    value={s.to}
                    min={s.from}
                    onChange={(e) => update(kind, { to: e.target.value })}
                    readOnly={s.annual}
                    hint={s.annual ? "Un anno dalla data di inizio." : undefined}
                    required
                  />
                  <Field
                    name={`${kind}_amount`}
                    label="Importo (IVA incl.)"
                    value={s.amount}
                    onChange={(e) => update(kind, { amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="0,00"
                    required
                    hint={s.fromList ? `Dal listino: ${s.fromList}` : prices[kind] ? `Listino: ${moneyInput(prices[kind])} €` : undefined}
                  />
                  <label className="flex items-center gap-2 text-sm text-ink sm:col-span-full">
                    <input
                      type="checkbox"
                      name={`${kind}_annual`}
                      checked={s.annual}
                      onChange={(e) =>
                        update(kind, e.target.checked && isValidISODate(s.from) ? { annual: true, to: annualEnd(s.from) } : { annual: e.target.checked })
                      }
                    />
                    Annuale <span className="text-muted">(fino al 31 dicembre)</span>
                  </label>
                </div>
              )}
            </div>
          );
        })}

        <div className="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-2">
          <Field
            name="gestione_amount"
            label={`${CONTRACT_ITEM_LABEL.gestione} (€)`}
            value={gestione}
            onChange={(e) => onGestione(e.target.value)}
            inputMode="decimal"
            placeholder="Nessuna"
            hint="Vuoto se non previste."
          />
          <Field
            name="rifiuti_amount"
            label={`${CONTRACT_ITEM_LABEL.rifiuti} (€)`}
            value={rifiuti}
            onChange={(e) => onRifiuti(e.target.value)}
            inputMode="decimal"
            placeholder="Nessuna"
            hint="Vuoto se non prevista."
          />
        </div>
        <p className="text-sm text-muted">Ogni voce diventa un addebito separato, con scadenza al primo pagamento del contratto.</p>
      </div>
    </fieldset>
  );
}

function spacesTotal(spaces: Record<SpaceKind, SpaceState>): number {
  let total = 0;
  for (const kind of SPACE_ITEM_KINDS) if (spaces[kind].on) total += parseMoney(spaces[kind].amount) ?? 0;
  return total;
}

/** Importo predefinito di una spesa fissa nel formato del campo; vuoto se non impostato. */
export function feeInput(cents: number | null): string {
  return cents ? moneyInput(cents) : "";
}
