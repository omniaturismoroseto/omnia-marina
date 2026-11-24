"use client";

import Link from "next/link";
import { ActionButton, CheckboxField, Field, Form, FormMessage, SelectField, Submit, TextareaField } from "@/components/form";
import { STATE_LABEL } from "@/lib/berth-states";
import { contractNumberLabel } from "@/lib/contract-numbers";
import { formatDate } from "@/lib/dates";
import { metersInput } from "@/lib/format";
import { CONTRACT_TYPE_LABEL } from "@/lib/labels";
import { deleteBerth, saveBerth } from "@/server/settings-actions";
import { Drawer } from "./drawer";
import { STATE_CELL } from "./states";
import type { ManagerBerth, ManagerCategory } from "./types";

/** Scheda di un posto senza lasciare la pagina: chi lo occupa oggi, misure, categoria, stato e note. */
export function BerthPanel({
  berth,
  where,
  categories,
  onClose,
}: {
  berth: ManagerBerth;
  /** «Pontile G · tratto CN» */
  where: string;
  categories: ManagerCategory[];
  onClose: () => void;
}) {
  const o = berth.occupant;
  return (
    <Drawer title={`Posto ${berth.code}`} subtitle={where} onClose={onClose}>
      <div className={`rounded-md border px-3 py-2.5 text-sm ${STATE_CELL[berth.state]}`}>
        <p className="font-semibold">{STATE_LABEL[berth.state]}</p>
        {o ? (
          <>
            <p className="mt-1">
              <span className="font-medium">{o.boatName}</span> · {o.ownerName}
              {o.ownerPhone ? ` · ${o.ownerPhone}` : ""}
            </p>
            <p className="mt-0.5 opacity-90">
              {CONTRACT_TYPE_LABEL[o.type]} {contractNumberLabel(o.number)} · dal {formatDate(o.startDate)} al {formatDate(o.endDate)}
            </p>
            <Link href={`/contratti/${o.contractId}`} className="mt-1 inline-block font-medium underline underline-offset-2">
              Apri il contratto
            </Link>
          </>
        ) : berth.state === "libero" ? (
          <>
            <p className="mt-1 opacity-90">Nessun contratto in corso oggi.</p>
            <Link href={`/contratti/nuovo?posto=${berth.id}`} className="mt-1 inline-block font-medium underline underline-offset-2">
              Nuovo contratto su questo posto
            </Link>
          </>
        ) : (
          <p className="mt-1 opacity-90">{berth.notes ?? "Posto non disponibile."}</p>
        )}
      </div>

      <Form action={saveBerth} className="space-y-4">
        <input type="hidden" name="id" value={berth.id} />
        <input type="hidden" name="stay" value="1" />
        <input type="hidden" name="position" value={berth.position} />
        <div className="grid grid-cols-2 gap-3">
          {/* Con un contratto attivo il codice resta: il contratto lo legge dal posto e i contratti attivi non si modificano. */}
          {berth.activeContract ? (
            <div>
              <input type="hidden" name="code" value={berth.code} />
              <Field name="codeShown" label="Codice" value={berth.code} readOnly disabled hint={`Contratto attivo n. ${berth.activeContract}: il codice non si può cambiare. Per un nuovo codice serve un nuovo contratto.`} />
            </div>
          ) : (
            <Field name="code" label="Codice" defaultValue={berth.code} required />
          )}
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
        </div>
        <SelectField
          name="categoryId"
          label="Categoria tariffaria"
          defaultValue={berth.categoryId ?? ""}
          placeholder="Nessuna"
          options={categories.map((c) => ({ value: c.id, label: c.label }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field name="lengthCm" label="Lunghezza (m)" defaultValue={metersInput(berth.lengthCm)} inputMode="decimal" required />
          <Field name="beamCm" label="Larghezza (m)" defaultValue={metersInput(berth.beamCm)} inputMode="decimal" required />
          <Field name="draftCm" label="Fondale (m)" defaultValue={metersInput(berth.draftCm)} inputMode="decimal" />
          <SelectField
            name="side"
            label="Lato del pontile"
            defaultValue={berth.side}
            options={[
              { value: "sx", label: "Sinistro" },
              { value: "dx", label: "Destro" },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <CheckboxField name="hasWater" label="Acqua" defaultChecked={berth.hasWater} />
          <CheckboxField name="hasPower" label="Corrente" defaultChecked={berth.hasPower} />
        </div>
        <TextareaField name="notes" label="Note" defaultValue={berth.notes ?? ""} rows={2} hint="Es. motivo della manutenzione: compare sulla mappa." />
        <div className="flex flex-wrap items-center gap-3">
          <Submit>Salva</Submit>
          <FormMessage />
        </div>
      </Form>

      <div className="border-t border-line-soft pt-4">
        <ActionButton
          action={deleteBerth}
          fields={{ berthId: berth.id, stay: "1" }}
          variant="danger"
          size="sm"
          confirm={`Eliminare il posto ${berth.code}? Se ha contratti non si può: va messo fuori servizio.`}
        >
          Elimina il posto
        </ActionButton>
      </div>
    </Drawer>
  );
}
