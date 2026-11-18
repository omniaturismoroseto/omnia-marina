import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { Plus } from "lucide-react";
import { CheckboxField, Field, Form, FormMessage, SelectField, Submit } from "@/components/form";
import { page } from "@/components/page";
import { ButtonLink, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berths, boats, contracts, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { contractNumberLabel } from "@/lib/contract-numbers";
import { addDays, formatDate, todayRome } from "@/lib/dates";
import { formatDimensions } from "@/lib/format";
import { uuidOrNull } from "@/lib/params";
import { replaceContractBoatAction } from "@/server/contract-actions";

export const metadata: Metadata = { title: "Cambia barca" };

// Il cliente ha venduto la barca e ne porta un'altra nello stesso posto: il contratto firmato si conclude e nasce
// una bozza per la barca nuova (src/server/contracts.ts, replaceContractBoat).
export default page(async function ReplaceBoatPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const [row] = await db
    .select({ contract: contracts, ownerName: owners.displayName, boatName: boats.name, berthCode: berths.code, berthLength: berths.lengthCm, berthBeam: berths.beamCm })
    .from(contracts)
    .innerJoin(owners, eq(owners.id, contracts.ownerId))
    .innerJoin(boats, eq(boats.id, contracts.boatId))
    .leftJoin(berths, eq(berths.id, contracts.berthId))
    .where(and(eq(contracts.id, id), eq(contracts.marinaId, ctx.marinaId)))
    .limit(1);
  if (!row) notFound();
  const c = row.contract;
  const otherBoats = await db
    .select({ id: boats.id, name: boats.name, lengthCm: boats.lengthCm, beamCm: boats.beamCm })
    .from(boats)
    .where(and(eq(boats.ownerId, c.ownerId), eq(boats.marinaId, ctx.marinaId), ne(boats.id, c.boatId), isNull(boats.archivedAt)))
    .orderBy(asc(boats.name));

  const today = todayRome();
  const minDate = addDays(c.startDate, 1);
  const defaultDate = today < minDate ? minDate : today > c.endDate ? c.endDate : today;
  const fits = (b: { lengthCm: number; beamCm: number }) => row.berthLength === null || (b.lengthCm <= row.berthLength && b.beamCm <= (row.berthBeam ?? Infinity));

  return (
    <>
      <PageHeader
        title="Cambia barca"
        back={{ href: `/contratti/${id}`, label: `Contratto ${contractNumberLabel(c.number)}` }}
        description={`${row.ownerName} · ${row.boatName}${row.berthCode ? ` · posto ${row.berthCode}` : ""}`}
      />
      {c.status !== "attivo" ? (
        <Notice>Il cambio barca si fa solo su un contratto attivo.</Notice>
      ) : (
        <div className="grid max-w-3xl grid-cols-1 gap-5">
          <Card title="Cosa succede">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>
                Il contratto {c.number} si <strong className="text-ink">conclude il giorno prima del cambio</strong>: è un documento firmato e non si modifica. Se la
                barca è in porto risulta partita.
              </li>
              <li>
                Nasce una <strong className="text-ink">bozza</strong> per la barca nuova, con stesso posto, tipo e fine ({formatDate(c.endDate)}). Importo a zero: il
                canone pagato resta sul contratto {c.number}, indica l&apos;eventuale differenza. Poi la attivi e la fai firmare.
              </li>
              <li>Addebiti, incassi e altri spazi (posto auto, carrello…) restano sul contratto {c.number}.</li>
            </ul>
          </Card>
          <Card title="Barca nuova">
            {otherBoats.length === 0 ? (
              <EmptyState
                title="Il cliente non ha altre barche"
                description="Aggiungi prima la barca nuova alla scheda del cliente, poi torna qui."
                action={
                  <ButtonLink href={`/barche/nuova?cliente=${c.ownerId}`} variant="primary">
                    <Plus size={16} aria-hidden="true" />
                    Aggiungi barca
                  </ButtonLink>
                }
              />
            ) : (
              <Form action={replaceContractBoatAction} className="space-y-4">
                <input type="hidden" name="contractId" value={id} />
                <SelectField
                  name="newBoatId"
                  label="Barca"
                  placeholder="Scegli…"
                  options={otherBoats.map((b) => ({
                    value: b.id,
                    label: `${b.name} · ${formatDimensions(b.lengthCm, b.beamCm)}${fits(b) ? "" : " · più grande del posto"}`,
                  }))}
                  hint={row.berthLength !== null ? `Posto ${row.berthCode}: ${formatDimensions(row.berthLength, row.berthBeam ?? 0)}.` : undefined}
                  required
                />
                <Field
                  name="changeDate"
                  label="Dal giorno"
                  type="date"
                  defaultValue={defaultDate}
                  min={minDate}
                  max={c.endDate}
                  hint="Il primo giorno con la barca nuova."
                  required
                />
                <CheckboxField name="archiveOld" label={`Metti ${row.boatName} in archivio (venduta)`} defaultChecked />
                <FormMessage />
                <Submit>Concludi e prepara la bozza</Submit>
              </Form>
            )}
            <p className="hint mt-3">
              La barca nuova non c&apos;è ancora?{" "}
              <a href={`/barche/nuova?cliente=${c.ownerId}`} className="link">
                Aggiungila al cliente
              </a>
              .
            </p>
          </Card>
        </div>
      )}
    </>
  );
});
