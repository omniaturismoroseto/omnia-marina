"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionButton, CheckboxField, Field, Form, FormMessage, SelectField, Submit } from "@/components/form";
import { deleteBerths, makeBerthSection, renameBerths, updateBerths } from "@/server/settings-actions";

export interface BerthChip {
  id: string;
  code: string;
  /** Misure, categoria e stato: compare passandoci sopra. */
  title: string;
  inactive: boolean;
}

const KEEP = "Non cambiare";

/**
 * Posti di un pontile: toccandone uno si apre la sua scheda; con «Scegli più posti» si selezionano e si cambiano
 * insieme (categoria, misure, stato, acqua e corrente) o si eliminano.
 */
export function BerthList({
  pierId,
  pierCode,
  berths,
  categories,
}: {
  pierId: string;
  /** Sigla del pontile: proposta come nuova sigla dei posti. */
  pierCode: string;
  berths: BerthChip[];
  categories: { id: string; label: string }[];
}) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Solo i posti ancora presenti (dopo un'eliminazione la pagina si aggiorna).
  const selected = berths.filter((b) => picked.has(b.id));
  const ids = selected.map((b) => b.id).join(",");

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const chipClass = (b: BerthChip, on = false) =>
    `inline-flex min-w-12 items-center justify-center rounded border px-2 py-1 text-sm font-medium tabular-nums hover:border-sea ${
      on ? "border-sea bg-sea text-white" : b.inactive ? "border-line bg-line-soft text-faint" : "border-line bg-white text-ink"
    }`;

  if (berths.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        {selecting ? (
          <>
            <span className="text-muted">
              {selected.length} {selected.length === 1 ? "posto scelto" : "posti scelti"}
            </span>
            <button type="button" className="link" onClick={() => setPicked(new Set(berths.map((b) => b.id)))}>
              Tutti
            </button>
            <button type="button" className="link" onClick={() => setPicked(new Set())}>
              Nessuno
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setSelecting(false);
                setPicked(new Set());
              }}
            >
              Fine
            </button>
          </>
        ) : (
          <button type="button" className="link" onClick={() => setSelecting(true)}>
            Scegli più posti
          </button>
        )}
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {berths.map((b) => (
          <li key={b.id}>
            {selecting ? (
              <button type="button" aria-pressed={picked.has(b.id)} title={b.title} className={chipClass(b, picked.has(b.id))} onClick={() => toggle(b.id)}>
                {b.code}
              </button>
            ) : (
              <Link href={`/impostazioni/pontili/posto/${b.id}`} title={b.title} className={chipClass(b)}>
                {b.code}
              </Link>
            )}
          </li>
        ))}
      </ul>

      {selecting && selected.length > 0 && (
        <section className="mt-3 rounded-md border border-line-soft bg-line-soft/40 p-3" aria-label="Cambia i posti scelti">
          <Form action={updateBerths} className="space-y-3">
            <input type="hidden" name="pierId" value={pierId} />
            <input type="hidden" name="berthIds" value={ids} />
            <p className="text-sm text-muted">Cambia solo quello che scegli: i campi lasciati su «{KEEP}» o vuoti restano come sono in ogni posto.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SelectField name="categoryId" label="Categoria" placeholder={KEEP} options={categories.map((c) => ({ value: c.id, label: c.label }))} />
              <SelectField
                name="status"
                label="Stato"
                placeholder={KEEP}
                options={[
                  { value: "attivo", label: "In servizio" },
                  { value: "manutenzione", label: "In manutenzione" },
                  { value: "fuori_servizio", label: "Fuori servizio" },
                ]}
              />
              <Field name="draftCm" label="Fondale (m)" inputMode="decimal" placeholder={KEEP} />
              <Field name="lengthCm" label="Lunghezza (m)" inputMode="decimal" placeholder={KEEP} />
              <Field name="beamCm" label="Larghezza (m)" inputMode="decimal" placeholder={KEEP} />
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  name="hasWater"
                  label="Acqua"
                  placeholder={KEEP}
                  options={[
                    { value: "si", label: "Sì" },
                    { value: "no", label: "No" },
                  ]}
                />
                <SelectField
                  name="hasPower"
                  label="Corrente"
                  placeholder={KEEP}
                  options={[
                    { value: "si", label: "Sì" },
                    { value: "no", label: "No" },
                  ]}
                />
              </div>
            </div>
            <CheckboxField name="categorySizes" label="Lunghezza e larghezza della categoria scelta" hint="Al posto delle misure scritte qui sopra." />
            <div className="flex flex-wrap items-center gap-3">
              <Submit variant="secondary">
                Applica {selected.length === 1 ? "al posto scelto" : `ai ${selected.length} posti`}
              </Submit>
              <FormMessage />
            </div>
          </Form>
          <Form action={renameBerths} className="mt-3 space-y-3 border-t border-line-soft pt-3">
            <input type="hidden" name="pierId" value={pierId} />
            <input type="hidden" name="berthIds" value={ids} />
            <h3 className="text-sm font-semibold text-ink">Cambia i codici</h3>
            <p className="text-sm text-muted">
              Nuova sigla per i posti scelti, per esempio da CN01 a {pierCode || "G"}01. Se i posti hanno sigle diverse con gli stessi numeri
              (CN01 e CS01), scegli «Rinumera in fila»: in ordine di codice prendono i numeri dal primo in poi. Contratti e pianta restano collegati.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field name="prefix" label="Nuova sigla" defaultValue={pierCode} maxLength={6} required />
              <SelectField
                name="numbering"
                label="Numeri"
                defaultValue="mantieni"
                options={[
                  { value: "mantieni", label: "Mantieni i numeri" },
                  { value: "rinumera", label: "Rinumera in fila" },
                ]}
              />
              <Field name="from" label="Primo numero (se rinumeri)" defaultValue="1" inputMode="numeric" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Submit variant="secondary">
                Cambia {selected.length === 1 ? "il codice" : `i ${selected.length} codici`}
              </Submit>
              <FormMessage />
            </div>
          </Form>
          <Form action={makeBerthSection} className="mt-3 space-y-3 border-t border-line-soft pt-3">
            <input type="hidden" name="pierId" value={pierId} />
            <input type="hidden" name="berthIds" value={ids} />
            <h3 className="text-sm font-semibold text-ink">Fai un tratto della pianta</h3>
            <p className="text-sm text-muted">
              I posti scelti diventano un tratto che in Mappa del porto si sposta, ruota e traccia da solo (per esempio un braccio del
              pontile o un pontile unito a questo). Per la gestione il pontile resta uno solo.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Field name="label" label="Nome del tratto" defaultValue={commonPrefix(selected.map((b) => b.code))} maxLength={20} required />
              <Submit variant="secondary">Crea il tratto</Submit>
              <FormMessage />
            </div>
          </Form>
          <div className="mt-3 border-t border-line-soft pt-3">
            <ActionButton
              action={deleteBerths}
              fields={{ pierId, berthIds: ids }}
              variant="danger"
              size="sm"
              confirm={`Eliminare ${selected.length === 1 ? `il posto ${selected[0].code}` : `${selected.length} posti (${selected.map((b) => b.code).join(", ")})`}? I posti con contratti restano.`}
            >
              Elimina {selected.length === 1 ? "il posto scelto" : `i ${selected.length} posti`}
            </ActionButton>
          </div>
        </section>
      )}
    </div>
  );
}

// Lettere iniziali comuni ai codici scelti (CN01, CN02 → CN): nome proposto per il tratto.
function commonPrefix(codes: string[]): string {
  const letters = codes.map((c) => c.replace(/\d+$/, ""));
  return letters.every((l) => l === letters[0]) ? (letters[0] ?? "") : "";
}
