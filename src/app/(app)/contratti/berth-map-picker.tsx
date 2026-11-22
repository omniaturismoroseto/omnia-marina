"use client";

import { useMemo, useRef, useState } from "react";
import { Map as MapIcon, X } from "@/components/icons";
import { buildDrawing } from "@/lib/plan-drawing";
import { extendBounds } from "@/lib/plan-features";
import type { BerthOption } from "@/server/contract-actions";
import type { PlanMapData } from "@/server/plan-map";
import { PlanView, type PlanViewBerth } from "../mappa/plan-view";
import { PlanZoom } from "../mappa/plan-zoom";

/**
 * «Scegli dalla mappa»: apre lo schema del porto in una finestra; i posti liberi e adatti alla barca nel periodo sono in
 * verde e si scelgono con un clic, gli altri sono grigi (al passaggio dicono perché).
 */
export function BerthMapPicker({
  map,
  options,
  selectedId,
  onSelect,
}: {
  map: PlanMapData;
  // Disponibilità dei posti per barca e date scelte; null finché non sono scelte.
  options: BerthOption[] | null;
  selectedId: string;
  onSelect: (berthId: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const drawing = useMemo(() => buildDrawing(map.piers, map.pxPerMeter), [map]);
  if (!drawing) return null;
  const bounds = map.baseUrl ? { x: 0, y: 0, width: map.width, height: map.height } : extendBounds(drawing.bounds, map.features, map.width, map.height);

  const byId = new Map((options ?? []).map((o) => [o.id, o]));
  const berths: PlanViewBerth[] = map.berths.map((b) => {
    const option = byId.get(b.id);
    return {
      ...b,
      occupant: null,
      state: option?.available ? "libero" : "fermo",
      note: option?.available ? `libero, ${option.size}` : (option?.reason ?? "non disponibile"),
    };
  });
  const free = berths.filter((b) => b.state === "libero").length;

  function show() {
    setOpen(true);
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={show} disabled={!options}>
        <MapIcon size={16} aria-hidden="true" />
        Scegli dalla mappa
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(72rem,calc(100vw-2rem))] max-w-none rounded-lg bg-card p-0 shadow-xl backdrop:bg-ink/40"
        aria-label="Scegli il posto dalla mappa"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Scegli il posto dalla mappa</h2>
            <p className="text-sm text-muted">
              <span className="mr-1 inline-block size-2.5 rounded-sm border border-[#1b6b4f] bg-[#dff1e9] align-middle" /> {free} liberi e adatti alla barca ·{" "}
              <span className="mx-1 inline-block size-2.5 rounded-sm border border-[#8794a0] bg-[#d9d6cc] align-middle" /> non disponibili. Tocca un posto
              verde per sceglierlo.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={close} aria-label="Chiudi">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="p-2">
          {open && (
            <PlanZoom width={bounds.width} height={bounds.height}>
              <PlanView
                mode="schema"
                drawing={drawing}
                features={map.features}
                bounds={bounds}
                baseUrl={map.baseUrl}
                berths={berths}
                width={map.width}
                height={map.height}
                pxPerMeter={map.pxPerMeter}
                imageUrl=""
                selectedId={selectedId || null}
                onSelect={(id) => {
                  onSelect(id);
                  close();
                }}
              />
            </PlanZoom>
          )}
        </div>
      </dialog>
    </>
  );
}
