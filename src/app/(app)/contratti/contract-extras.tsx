"use client";

import { useState } from "react";
import { Field } from "@/components/form";
import { moneyInput, parseMoney } from "@/lib/format";
import { CONTRACT_ITEM_LABEL } from "@/lib/labels";
import { SPACE_ITEM_KINDS } from "@/lib/contract-items";

type SpaceKind = (typeof SPACE_ITEM_KINDS)[number];
type SpaceState = { on: boolean; ref: string; from: string; to: string; amount: string };

const HAS_REFERENCE: Record<SpaceKind, boolean> = { secca: false, auto_coperto: true, auto_scoperto: true, carrello: false };

/**
 * Voci del contratto oltre al posto barca: spazi a terra, posti auto e carrello (con periodo e importo)
 * e le spese fisse di gestione e rifiuti. I campi si chiamano <tipo>_on, _ref, _from, _to, _amount.
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
}) {
  const [spaces, setSpaces] = useState<Record<SpaceKind, SpaceState>>(
    () => Object.fromEntries(SPACE_ITEM_KINDS.map((k) => [k, { on: false, ref: "", from: "", to: "", amount: "" }])) as Record<SpaceKind, SpaceState>,
  );

  function update(kind: SpaceKind, patch: Partial<SpaceState>) {
    const next = { ...spaces, [kind]: { ...spaces[kind], ...patch } };
    setSpaces(next);
    onSpacesTotal(spacesTotal(next));
  }

  return (
    <fieldset className="card p-4">
      <legend className="float-left mb-3 w-full text-[15px] font-semibold text-ink">Altri spazi e spese</legend>
      <div className="clear-both space-y-3">
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
                        ? { on: true, from: s.from || startDate, to: s.to || endDate, amount: s.amount || (prices[kind] ? moneyInput(prices[kind]) : "") }
                        : { on: false },
                    )
                  }
                />
                {CONTRACT_ITEM_LABEL[kind]}
              </label>
              {s.on && (
                <div className={`mt-3 grid grid-cols-1 gap-3 ${HAS_REFERENCE[kind] ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
                  {HAS_REFERENCE[kind] && <Field name={`${kind}_ref`} label="Numero" value={s.ref} onChange={(e) => update(kind, { ref: e.target.value })} />}
                  <Field name={`${kind}_from`} label="Dal" type="date" value={s.from} onChange={(e) => update(kind, { from: e.target.value })} required />
                  <Field name={`${kind}_to`} label="Al" type="date" value={s.to} min={s.from} onChange={(e) => update(kind, { to: e.target.value })} required />
                  <Field
                    name={`${kind}_amount`}
                    label="Importo (IVA incl.)"
                    value={s.amount}
                    onChange={(e) => update(kind, { amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="0,00"
                    required
                    hint={prices[kind] ? `Listino: ${moneyInput(prices[kind])} €` : undefined}
                  />
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
