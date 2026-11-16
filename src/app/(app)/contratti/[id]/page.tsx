import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Printer } from "lucide-react";
import { MovementButtons } from "@/components/movement-buttons";
import { page } from "@/components/page";
import { ChargeStatusBadge, ContractStatusBadge, PresenceBadge } from "@/components/status";
import { Badge, ButtonLink, Card, Details, EmptyState, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berths, boats, contractItems, contracts, movements, owners, users } from "@/db/schema";
import { itemTitle, sortItems } from "@/lib/contract-items";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, formatDateTime, todayRome } from "@/lib/dates";
import { formatDimensions, formatMoney, splitVat } from "@/lib/format";
import { CONTRACT_TYPE_LABEL, MOVEMENT_LABEL } from "@/lib/labels";
import { uuidOrNull } from "@/lib/params";
import { listCharges } from "@/server/charges";
import { extrasForDate } from "@/server/list-extras";
import { latestConsents } from "@/server/owners";
import { ActivateForm, AddContractItemForm, CancelContractButton, ContractMetaForm, RemoveContractItemButton } from "./contract-forms";

export const metadata: Metadata = { title: "Contratto" };

export default page(async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();

  const [row] = await db
    .select({ contract: contracts, ownerName: owners.displayName, boat: boats, berthCode: berths.code })
    .from(contracts)
    .innerJoin(owners, eq(owners.id, contracts.ownerId))
    .innerJoin(boats, eq(boats.id, contracts.boatId))
    .leftJoin(berths, eq(berths.id, contracts.berthId))
    .where(and(eq(contracts.id, id), eq(contracts.marinaId, ctx.marinaId)))
    .limit(1);
  if (!row) notFound();
  const { contract: c, boat } = row;
  const today = todayRome();

  const [chargeRows, moveRows, consents, itemRows, listExtras] = await Promise.all([
    listCharges(ctx.marinaId, today, { contractId: id }),
    db
      .select({ id: movements.id, kind: movements.kind, at: movements.at, note: movements.note, userName: users.name })
      .from(movements)
      .leftJoin(users, eq(users.id, movements.userId))
      .where(eq(movements.contractId, id))
      .orderBy(desc(movements.at)),
    latestConsents(ctx.marinaId, c.ownerId),
    db.select().from(contractItems).where(and(eq(contractItems.contractId, id), eq(contractItems.marinaId, ctx.marinaId))),
    extrasForDate(ctx.marinaId, c.startDate),
  ]);
  const items = sortItems(itemRows);
  const itemsTotal = items.reduce((sum, it) => sum + it.amountCents, 0);

  const { netCents, vatCents } = splitVat(c.amountCents, c.vatRate);
  const live = chargeRows.filter((ch) => ch.status !== "annullato");
  const billed = live.reduce((s, ch) => s + ch.grossCents, 0);
  const paid = live.reduce((s, ch) => s + ch.paidCents, 0);
  const privacyMissing = !consents.get(c.ownerId)?.informativa?.granted;
  const insuranceExpired = boat.insuranceExpiry !== null && boat.insuranceExpiry < today;
  const open = c.status === "attivo" || c.status === "bozza";

  return (
    <>
      <PageHeader
        title={`Contratto ${c.number}`}
        back={{ href: "/contratti", label: "Contratti" }}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge>{CONTRACT_TYPE_LABEL[c.type]}</Badge>
            <ContractStatusBadge status={c.status} />
            {c.status === "attivo" && <PresenceBadge presence={c.presence} />}
          </span>
        }
        actions={
          <ButtonLink href={`/contratti/${id}/stampa`}>
            <Printer size={16} aria-hidden="true" />
            Stampa
          </ButtonLink>
        }
      />

      {open && (privacyMissing || insuranceExpired || !c.signedOn) && (
        <div className="mb-5 space-y-2">
          {privacyMissing && (
            <Notice>
              Il cliente non ha ancora firmato l&apos;informativa privacy.{" "}
              <Link href={`/clienti/${c.ownerId}/informativa`} className="link">
                Stampa il modulo
              </Link>
            </Notice>
          )}
          {insuranceExpired && <Notice tone="bad">L&apos;assicurazione della barca è scaduta il {formatDate(boat.insuranceExpiry)}.</Notice>}
          {!c.signedOn && c.status === "attivo" && <Notice>Il contratto non risulta ancora firmato: stampa, fai firmare e indica la data di firma.</Notice>}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-5">
          <Card title="Riepilogo">
            <Details
              columns={3}
              items={[
                ["Cliente", <Link key="o" href={`/clienti/${c.ownerId}`} className="link">{row.ownerName}</Link>],
                ["Barca", <Link key="b" href={`/barche/${boat.id}`} className="link">{boat.name}</Link>],
                ["Dimensioni barca", formatDimensions(boat.lengthCm, boat.beamCm)],
                [
                  "Posto barca",
                  row.berthCode ? (
                    <Link key="p" href={`/mappa?posto=${c.berthId}`} className="link">
                      {row.berthCode}
                    </Link>
                  ) : (
                    <span className="text-warn">Da assegnare</span>
                  ),
                ],
                [c.type === "transito" ? "Arrivo" : "Inizio", formatDate(c.startDate)],
                [c.type === "transito" ? "Partenza" : "Fine", formatDate(c.endDate)],
                ["Canone posto barca (IVA incl.)", <strong key="a">{formatMoney(c.amountCents)}</strong>],
                ["Imponibile e IVA", `${formatMoney(netCents)} + ${formatMoney(vatCents)} (${c.vatRate}%)`],
                ["Firmato il", c.signedOn ? formatDate(c.signedOn) : null],
                ["Arrivo registrato", c.checkedInAt ? formatDateTime(c.checkedInAt) : null],
                ["Partenza registrata", c.checkedOutAt ? formatDateTime(c.checkedOutAt) : null],
                ["Note", c.notes],
              ]}
            />
          </Card>

          <Card title="Altri spazi e spese" flush>
            {items.length === 0 ? (
              <EmptyState title="Nessuna voce aggiuntiva" description={open ? "Posti auto, sosta a terra, carrello, spese di gestione e rifiuti si aggiungono dal riquadro a lato." : undefined} />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Voce</th>
                    <th>Periodo</th>
                    <th className="num">Importo</th>
                    {open && <th aria-label="Azioni" />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td>
                        {itemTitle(it)}
                        {it.vatRate === 0 && <span className="text-xs text-muted"> · senza IVA</span>}
                      </td>
                      <td className="whitespace-nowrap text-muted tabular-nums">
                        {it.startDate ? `${it.annual ? "Annuale · " : ""}${formatDate(it.startDate)} – ${formatDate(it.endDate)}` : "—"}
                      </td>
                      <td className="num">{formatMoney(it.amountCents)}</td>
                      {open && (
                        <td className="text-right">
                          <RemoveContractItemButton itemId={it.id} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="px-3 py-2.5 text-right text-sm font-medium">
                      Totale contratto (posto barca + altre voci)
                    </td>
                    <td className="num px-3 py-2.5 font-semibold">{formatMoney(c.amountCents + itemsTotal)}</td>
                    {open && <td />}
                  </tr>
                </tfoot>
              </table>
            )}
          </Card>

          <Card title="Addebiti e incassi" flush>
            {chargeRows.length === 0 ? (
              <EmptyState
                title={c.status === "bozza" ? "Gli addebiti nascono all'attivazione" : "Nessun addebito"}
                description={c.status === "bozza" ? "Attiva il contratto per generare le rate da incassare." : undefined}
              />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Scadenza</th>
                    <th>Descrizione</th>
                    <th>Stato</th>
                    <th className="num">Importo</th>
                    <th className="num">Incassato</th>
                  </tr>
                </thead>
                <tbody>
                  {chargeRows.map((ch) => (
                    <tr key={ch.id}>
                      <td className="whitespace-nowrap tabular-nums">{formatDate(ch.dueDate)}</td>
                      <td>
                        <Link href={`/contabilita/addebiti/${ch.id}`} className="link">
                          {ch.description}
                        </Link>
                      </td>
                      <td>
                        <ChargeStatusBadge status={ch.status} />
                      </td>
                      <td className="num">{formatMoney(ch.grossCents)}</td>
                      <td className="num text-muted">{formatMoney(ch.paidCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="px-3 py-2.5 text-right text-sm font-medium">
                      Da incassare <strong className={billed - paid > 0 ? "text-bad" : "text-ok"}>{formatMoney(billed - paid)}</strong>
                    </td>
                    <td className="num px-3 py-2.5 font-semibold">{formatMoney(billed)}</td>
                    <td className="num px-3 py-2.5 font-semibold">{formatMoney(paid)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </Card>

          {moveRows.length > 0 && (
            <Card title="Movimenti" flush>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Data e ora</th>
                    <th>Movimento</th>
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
                      <td className="text-muted">{m.userName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {c.status === "bozza" && (
            <Card title="Attivazione">
              {c.berthId ? (
                <>
                  <p className="mb-3 text-sm text-muted">Attivando il contratto il posto {row.berthCode} viene impegnato e nascono gli addebiti delle rate.</p>
                  <ActivateForm contractId={id} firstDueDate={c.startDate > today ? c.startDate : today} />
                </>
              ) : (
                <p className="text-sm text-muted">Questa bozza non ha un posto barca: annullala e crea un nuovo contratto scegliendo il posto.</p>
              )}
            </Card>
          )}

          {c.status === "attivo" && (
            <Card title="In banchina">
              {c.startDate > today && c.presence === "atteso" ? (
                <p className="text-sm text-muted">Arrivo previsto il {formatDate(c.startDate)}.</p>
              ) : (
                <MovementButtons contractId={id} presence={c.presence} canArrive departing={c.endDate <= today} earlyDeparture />
              )}
            </Card>
          )}

          {open && (
            <Card title="Aggiungi spazio o spesa">
              <AddContractItemForm contractId={id} startDate={c.startDate} endDate={c.endDate} active={c.status === "attivo"} listExtras={listExtras} annualDefault={c.type === "annuale"} />
            </Card>
          )}

          {open && (
            <Card title="Firma e note">
              <ContractMetaForm contractId={id} signedOn={c.signedOn} notes={c.notes} />
            </Card>
          )}

          {open && (c.presence === "atteso" || c.status === "bozza") && <CancelContractButton contractId={id} draft={c.status === "bozza"} />}
        </div>
      </div>
    </>
  );
});
