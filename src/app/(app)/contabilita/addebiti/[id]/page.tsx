import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { ChargeStatusBadge } from "@/components/status";
import { Card, Details, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { charges, contracts, owners, payments, users } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, todayRome } from "@/lib/dates";
import { formatMoney, moneyInput } from "@/lib/format";
import { CHARGE_KIND_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { uuidOrNull } from "@/lib/params";
import { contractNumberLabel } from "@/lib/contract-numbers";
import { chargeStatus } from "@/server/accounting";
import { CancelChargeButton, PaymentForm, RemovePaymentButton } from "../../accounting-forms";

export const metadata: Metadata = { title: "Addebito" };

export default page(async function ChargePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();

  const [row] = await db
    .select({ charge: charges, ownerName: owners.displayName, contractNumber: contracts.number })
    .from(charges)
    .innerJoin(owners, eq(owners.id, charges.ownerId))
    .leftJoin(contracts, eq(contracts.id, charges.contractId))
    .where(and(eq(charges.id, id), eq(charges.marinaId, ctx.marinaId)))
    .limit(1);
  if (!row) notFound();
  const { charge } = row;

  const paymentRows = await db
    .select({ id: payments.id, paidOn: payments.paidOn, amountCents: payments.amountCents, method: payments.method, reference: payments.reference, userName: users.name })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.createdBy))
    .where(eq(payments.chargeId, id))
    .orderBy(asc(payments.paidOn), asc(payments.createdAt));

  const today = todayRome();
  const paid = paymentRows.reduce((s, p) => s + p.amountCents, 0);
  const residual = charge.grossCents - paid;
  const status = chargeStatus(charge, paid, today);

  return (
    <>
      <PageHeader
        title={charge.description}
        back={{ href: "/contabilita", label: "Scadenziario" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ChargeStatusBadge status={status} />
            <span>Scadenza {formatDate(charge.dueDate)}</span>
          </span>
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-5">
          <Card title="Dettaglio">
            <Details
              columns={3}
              items={[
                ["Cliente", <Link key="o" href={`/clienti/${charge.ownerId}`} className="link">{row.ownerName}</Link>],
                ["Tipo", CHARGE_KIND_LABEL[charge.kind]],
                ["Contratto", charge.contractId && <Link key="c" href={`/contratti/${charge.contractId}`} className="link">{contractNumberLabel(row.contractNumber)}</Link>],
                ["Data dell'addebito", formatDate(charge.issueDate)],
                ["Scadenza", formatDate(charge.dueDate)],
                ["Importo (IVA inclusa)", <strong key="g">{formatMoney(charge.grossCents)}</strong>],
                ["Imponibile", formatMoney(charge.netCents)],
                [`IVA ${charge.vatRate}%`, formatMoney(charge.vatCents)],
                ["Residuo da incassare", status === "annullato" ? null : <strong key="r" className={residual > 0 ? "text-bad" : "text-ok"}>{formatMoney(residual)}</strong>],
                ["Note", charge.notes],
              ]}
            />
          </Card>

          <Card title={`Incassi (${paymentRows.length})`} flush>
            {paymentRows.length === 0 ? (
              <EmptyState title="Nessun incasso registrato" />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Metodo</th>
                    <th>Riferimento</th>
                    <th>Registrato da</th>
                    <th className="num">Importo</th>
                    <th>
                      <span className="sr-only">Azioni</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paymentRows.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap tabular-nums">{formatDate(p.paidOn)}</td>
                      <td>{PAYMENT_METHOD_LABEL[p.method]}</td>
                      <td className="text-muted">{p.reference ?? "—"}</td>
                      <td className="text-muted">{p.userName ?? "—"}</td>
                      <td className="num font-medium">{formatMoney(p.amountCents)}</td>
                      <td className="text-right">
                        <RemovePaymentButton paymentId={p.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {status !== "annullato" && residual > 0 && (
            <Card title="Registra incasso">
              <PaymentForm chargeId={id} today={today} residual={moneyInput(residual)} />
            </Card>
          )}
          {status !== "annullato" && paymentRows.length === 0 && <CancelChargeButton chargeId={id} />}
          {status === "annullato" && <p className="text-sm text-muted">Addebito annullato: non è più da incassare.</p>}
        </div>
      </div>
    </>
  );
});
