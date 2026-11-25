"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Map as MapIcon, X } from "@/components/icons";
import { formatDate, isValidISODate } from "@/lib/dates";
import { buildDrawing } from "@/lib/plan-drawing";
import { parkingOptionsAction } from "@/server/parking-actions";
import type { ParkingOption } from "@/server/parking";
import type { PlanMapData } from "@/server/plan-map";
import type { ParkingMark } from "../mappa/parking-marks";
import { PlanView, type PlanViewBerth } from "../mappa/plan-view";
import { PlanZoom } from "../mappa/plan-zoom";

const describe = (o: ParkingOption) =>
  !o.active
    ? "fuori servizio"
    : o.takenBy
      ? `di ${o.takenBy.ownerName} fino al ${formatDate(o.takenBy.endDate)}`
      : "libero";

/**
 * Scelta del posto auto per una voce «posto auto coperto/scoperto» del contratto: elenco dei posti del tipo giusto, con quelli già
 * assegnati nel periodo (o fuori servizio) non sceglibili, e «Scegli dalla mappa». Se il porto non ha posti auto di quel tipo,
 * mostra `fallback` (il campo del numero scritto a mano). Il posto scelto va nel campo nascosto `name`.
 */
export function ParkingPicker({
  name,
  covered,
  from,
  to,
  contractId = null,
  value,
  onChange,
  map,
  fallback,
}: {
  name: string;
  covered: boolean;
  from: string;
  to: string;
  contractId?: string | null;
  value: string;
  onChange: (id: string) => void;
  map: PlanMapData | null;
  fallback: ReactNode;
}) {
  const valid = isValidISODate(from) && isValidISODate(to) && to >= from;
  const key = valid ? `${from}:${to}` : null;
  const [loaded, setLoaded] = useState<{ key: string; options: ParkingOption[] } | null>(null);

  // Disponibilità nel periodo della voce: si rilegge quando cambiano le date; vale solo l'ultima risposta.
  useEffect(() => {
    if (!key) return;
    let current = true;
    parkingOptionsAction({ from, to, contractId }).then((options) => {
      if (current) setLoaded({ key, options });
    });
    return () => {
      current = false;
    };
  }, [key, from, to, contractId]);

  const options = loaded && loaded.key === key ? loaded.options.filter((o) => o.covered === covered) : null;
  const chosen = options?.find((o) => o.id === value);
  // Il posto scelto non è più libero nelle nuove date: si toglie la scelta.
  useEffect(() => {
    if (chosen && (chosen.takenBy || !chosen.active)) onChange("");
  }, [chosen, onChange]);

  if (!valid) return <p className="text-sm text-muted sm:col-span-full">Indica le date per vedere i posti auto liberi.</p>;
  if (options === null) return <p className="text-sm text-muted sm:col-span-full">Cerco i posti auto liberi…</p>;
  if (options.length === 0) return <>{fallback}</>;
  const free = options.filter((o) => o.active && !o.takenBy);

  return (
    <div className="sm:col-span-full">
      <input type="hidden" name={name} value={value} />
      <label className="label" htmlFor={`${name}-select`}>
        Quale posto auto
      </label>
      <div className="flex flex-wrap gap-2">
        <select id={`${name}-select`} className="input min-w-0 flex-1" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{free.length ? `Scegli tra ${free.length} liberi…` : "Nessun posto auto libero nel periodo"}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={!o.active || Boolean(o.takenBy)}>
              {o.code}
              {o.active && !o.takenBy ? "" : ` — ${describe(o)}`}
            </option>
          ))}
        </select>
        {map && map.parking.some((p) => p.covered === covered) && (
          <ParkingMapButton map={map} options={options} selectedId={value} onSelect={onChange} />
        )}
      </div>
      <p className="hint">Si vedono solo i posti auto {covered ? "coperti" : "scoperti"}; quelli già assegnati in queste date non si possono scegliere.</p>
    </div>
  );
}

/** «Scegli dalla mappa» per i posti auto: i liberi si scelgono con un clic, gli altri sono grigi e dicono di chi sono. */
function ParkingMapButton({
  map,
  options,
  selectedId,
  onSelect,
}: {
  map: PlanMapData;
  options: ParkingOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const drawing = useMemo(() => buildDrawing(map.piers, map.pxPerMeter), [map]);
  if (!drawing) return null;
  // Tutta la foto: i parcheggi spesso stanno a terra, fuori dallo schema dei pontili.
  const bounds = { x: 0, y: 0, width: map.width, height: map.height };
  const byId = new Map(options.map((o) => [o.id, o]));
  const parking: ParkingMark[] = map.parking.flatMap((p) => {
    const o = byId.get(p.id);
    if (!o) return [];
    return [{ ...p, state: o.active && !o.takenBy ? "libero" : "fermo", note: describe(o) }];
  });
  // Solo i pontili sullo sfondo: i posti barca qui non servono e coprirebbero i posti auto.
  const berths: PlanViewBerth[] = [];
  const free = parking.filter((p) => p.state === "libero").length;

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          setOpen(true);
          dialogRef.current?.showModal();
        }}
      >
        <MapIcon size={16} aria-hidden="true" />
        Scegli dalla mappa
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(72rem,calc(100vw-2rem))] max-w-none rounded-lg bg-card p-0 shadow-xl backdrop:bg-ink/40"
        aria-label="Scegli il posto auto dalla mappa"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Scegli il posto auto dalla mappa</h2>
            <p className="text-sm text-muted">{free} liberi in queste date: tocca un posto chiaro per sceglierlo; quelli grigi non sono disponibili.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => dialogRef.current?.close()} aria-label="Chiudi">
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
                selectedId={null}
                onSelect={() => {}}
                parking={parking}
                selectedParkingId={selectedId || null}
                onSelectParking={(id) => {
                  onSelect(id);
                  dialogRef.current?.close();
                }}
              />
            </PlanZoom>
          )}
        </div>
      </dialog>
    </>
  );
}
