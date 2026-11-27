"use client";

import { useActionState } from "react";
import { Redo2, Undo2 } from "@/components/icons";
import { stepSettingsHistory } from "@/server/settings-actions";

const BTN =
  "inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-ink hover:bg-line-soft disabled:opacity-40";

/**
 * «Indietro» e «Avanti» per le modifiche già salvate (Impostazioni → Porto, scheda del pontile): annullano o rifanno
 * l'ultima modifica salvata, se da allora non è cambiato altro. `undo`/`redo` sono le descrizioni delle modifiche, null se non ce ne sono.
 */
export function SavedHistoryButtons({
  area,
  targetId,
  undo,
  redo,
}: {
  area: "porto" | "pontile";
  targetId: string;
  undo: string | null;
  redo: string | null;
}) {
  const [state, dispatch, pending] = useActionState(
    stepSettingsHistory,
    undefined,
  );
  return (
    <form action={dispatch} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="area" value={area} />
      <input type="hidden" name="targetId" value={targetId} />
      <span
        className="inline-flex items-center gap-1 rounded-md border border-line bg-white p-0.5"
        role="group"
        aria-label="Annulla e rifai le modifiche salvate"
      >
        <button
          type="submit"
          name="direction"
          value="indietro"
          className={BTN}
          disabled={pending || !undo}
          title={
            undo
              ? `Annulla l'ultima modifica salvata: ${undo}`
              : "Nessuna modifica salvata da annullare"
          }
        >
          <Undo2 size={16} aria-hidden="true" /> Indietro
        </button>
        <button
          type="submit"
          name="direction"
          value="avanti"
          className={BTN}
          disabled={pending || !redo}
          title={
            redo ? `Rifai: ${redo}` : "Nessuna modifica annullata da rifare"
          }
        >
          Avanti <Redo2 size={16} aria-hidden="true" />
        </button>
      </span>
      {state?.message && (
        <span
          role={state.ok ? "status" : "alert"}
          className={`max-w-72 text-right text-xs ${state.ok ? "text-ok" : "field-error"}`}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
