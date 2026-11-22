import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Pencil, Plus } from "@/components/icons";
import { ActionButton } from "@/components/form";
import { MovementButtons } from "@/components/movement-buttons";
import { page } from "@/components/page";
import { ContractStatusBadge, PresenceBadge } from "@/components/status";
import { Badge, ButtonLink, Card, Details, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berths, boats, contracts, movements, owners, users } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, formatDateTime, todayRome } from "@/lib/dates";
import { auxEngine, describeEngine, mainEngine } from "@/lib/engines";
import { formatDimensions, formatMeters, formatMoney } from "@/lib/format";
import { BOAT_TYPE_LABEL, CONTRACT_TYPE_LABEL, MOVEMENT_LABEL } from "@/lib/labels";
import { uuidOrNull } from "@/lib/params";
import { contractNumberLabel } from "@/lib/contract-numbers";
import { deleteBoat } from "@/server/boat-actions";
import { visibleUser } from "@/lib/account-manager";

export const metadata: Metadata = { title: "Scheda barca" };

export default page(async function BoatPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina();
  const office = OFFICE.includes(ctx.role);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();

  const [row] = await db
    .select({ boat: boats, ownerName: owners.displayName, ownerPhone: owners.phone })
    .from(boats)
    .innerJoin(owners, eq(owners.id, boats.ownerId))
    .where(and(eq(boats.id, id), eq(boats.marinaId, ctx.marinaId)))
    .limit(1);
  if (!row) notFound();
  const { boat } = row;
  const today = todayRome();

  const [contractRows, moveRows] = await Promise.all([
    db
      .select({
        id: contracts.id,
        number: contracts.number,
        type: contracts.type,
        status: contracts.status,
        presence: contracts.presence,
        startDate: contracts.startDate,
        endDate: contracts.endDate,
        occupiedUntil: contracts.occupiedUntil,
        berthCode: berths.code,
        berthId: berths.id,
      })
      .from(contracts)
      .leftJoin(berths, eq(berths.id, contracts.berthId))
      .where(eq(contracts.boatId, id))
      .orderBy(desc(contracts.startDate)),
    db
      .select({ id: movements.id, kind: movements.kind, at: movements.at, note: movements.note, berthCode: berths.code, userName: users.name })
      .from(movements)
      .leftJoin(berths, eq(berths.id, movements.berthId))
      .leftJoin(users, and(eq(users.id, movements.userId), visibleUser()))
      .where(eq(movements.boatId, id))
      .orderBy(desc(movements.at))
      .limit(20),
  ]);

  // Il contratto "in corso": quello attivo che copre oggi, o con la barca ancora presente.
  const current = contractRows.find(
    (c) => c.status === "attivo" && c.startDate <= today && (c.occupiedUntil > today || c.presence === "in_porto" || c.presence === "fuori"),
  );

  return (
    <>
      <PageHeader
        title={boat.name}
        back={{ href: "/barche", label: "Barche" }}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge>{BOAT_TYPE_LABEL[boat.type]}</Badge>
            {current?.berthCode && <Badge tone="sea">Posto {current.berthCode}</Badge>}
            {current && <PresenceBadge presence={current.presence} />}
          </span>
        }
        actions={
          office && (
            <>
              <ButtonLink href={`/barche/${id}/modifica`}>
                <Pencil size={16} aria-hidden="true" />
                Modifica
              </ButtonLink>
              <ButtonLink href={`/contratti/nuovo?barca=${id}`} variant="primary">
                <Plus size={16} aria-hidden="true" />
                Nuovo contratto
              </ButtonLink>
            </>
          )
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <Card title="Dati della barca">
            <Details
              columns={3}
              items={[
                ["Lunghezza × larghezza", formatDimensions(boat.lengthCm, boat.beamCm)],
                ["Pescaggio", boat.draftCm ? formatMeters(boat.draftCm) : null],
                ["Matricola", boat.registration],
                ["Cantiere e modello", [boat.builder, boat.model].filter(Boolean).join(" ") || null],
                ["Anno", boat.year],
                ["Bandiera", boat.flag],
                ["Motorizzazione", [describeEngine(mainEngine(boat)), boat.engine].filter(Boolean).join(" · ") || null],
                ["Motore ausiliario", describeEngine(auxEngine(boat)) || null],
                ["Valore dichiarato", boat.declaredValueCents !== null ? formatMoney(boat.declaredValueCents) : null],
                ["Note", boat.notes],
              ]}
            />
          </Card>

          {office && (
            <Card title={`Contratti (${contractRows.length})`} flush>
              {contractRows.length === 0 ? (
                <EmptyState title="Nessun contratto" description="Crea un contratto per assegnare un posto a questa barca." />
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Numero</th>
                      <th>Posto</th>
                      <th>Periodo</th>
                      <th>Stato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractRows.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/contratti/${c.id}`} className="link">
                            {contractNumberLabel(c.number)}
                          </Link>
                          <span className="block text-xs text-muted">{CONTRACT_TYPE_LABEL[c.type]}</span>
                        </td>
                        <td>{c.berthCode ?? "—"}</td>
                        <td className="whitespace-nowrap tabular-nums">
                          {formatDate(c.startDate)} – {formatDate(c.endDate)}
                        </td>
                        <td>
                          <ContractStatusBadge status={c.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          <Card title="Ultimi movimenti" flush>
            {moveRows.length === 0 ? (
              <EmptyState title="Nessun movimento registrato" />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Data e ora</th>
                    <th>Movimento</th>
                    <th>Posto</th>
                    <th>Operatore</th>
                  </tr>
                </thead>
                <tbody>
                  {moveRows.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap tabular-nums">{formatDateTime(m.at)}</td>
                      <td>
                        {MOVEMENT_LABEL[m.kind]}
                        {m.note && <span className="block text-xs text-muted">{m.note}</span>}
                      </td>
                      <td>{m.berthCode ?? "—"}</td>
                      <td className="text-muted">{m.userName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {current && (
            <Card title="In banchina">
              <p className="mb-3 text-sm text-muted">
                {current.berthCode ? (
                  <>
                    Posto{" "}
                    <Link href={`/mappa?posto=${current.berthId}`} className="link">
                      {current.berthCode}
                    </Link>{" "}
                    fino al {formatDate(current.endDate)}.
                  </>
                ) : (
                  "Nessun posto assegnato."
                )}
              </p>
              <MovementButtons contractId={current.id} presence={current.presence} canArrive departing={current.endDate <= today} />
            </Card>
          )}

          <Card title="Proprietario">
            <Details
              columns={1}
              items={[
                ["Nome", office ? <Link key="o" href={`/clienti/${boat.ownerId}`} className="link">{row.ownerName}</Link> : row.ownerName],
                ["Telefono", row.ownerPhone && <a href={`tel:${row.ownerPhone.replace(/\s/g, "")}`} className="link">{row.ownerPhone}</a>],
              ]}
            />
          </Card>

          <Card title="Assicurazione">
            {boat.insuranceExpiry && boat.insuranceExpiry < today && (
              <p className="mb-3 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">Polizza scaduta il {formatDate(boat.insuranceExpiry)}.</p>
            )}
            <Details
              columns={1}
              items={[
                ["Compagnia", boat.insuranceCompany],
                ["Polizza", office ? boat.insurancePolicy : null],
                ["Scadenza", boat.insuranceExpiry ? formatDate(boat.insuranceExpiry) : null],
              ]}
            />
          </Card>

          {office && contractRows.length === 0 && (
            <ActionButton action={deleteBoat} fields={{ boatId: id }} variant="danger" size="sm" confirm="Eliminare definitivamente questa barca?">
              Elimina barca
            </ActionButton>
          )}
        </div>
      </div>
    </>
  );
});
