import "server-only";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { charges, contracts, owners } from "@/db/schema";
import { chargeStatus, type ChargeStatus } from "./accounting";
import { paidByCharge } from "./dock";

export type ChargeFilter = "aperti" | "scaduti" | "pagati" | "annullati" | "tutti";

const paidExpr = sql<number>`coalesce(${paidByCharge.paid}, 0)::int`;

function filterSql(filter: ChargeFilter, today: string): SQL | undefined {
  const live = sql`${charges.cancelledAt} is null`;
  const open = sql`${charges.grossCents} > coalesce(${paidByCharge.paid}, 0)`;
  switch (filter) {
    case "aperti":
      return and(live, open);
    case "scaduti":
      return and(live, open, sql`${charges.dueDate} < ${today}`);
    case "pagati":
      return and(live, sql`${charges.grossCents} <= coalesce(${paidByCharge.paid}, 0)`);
    case "annullati":
      return sql`${charges.cancelledAt} is not null`;
    default:
      return undefined;
  }
}

export interface ChargeRow {
  id: string;
  ownerId: string;
  ownerName: string;
  contractId: string | null;
  contractNumber: string | null;
  kind: "ormeggio" | "servizi" | "utenze" | "altro";
  description: string;
  issueDate: string;
  dueDate: string;
  netCents: number;
  vatRate: number;
  vatCents: number;
  grossCents: number;
  paidCents: number;
  cancelledAt: Date | null;
  status: ChargeStatus;
}

export async function listCharges(
  marinaId: string,
  today: string,
  opts: { filter?: ChargeFilter; ownerId?: string; contractId?: string; q?: string; limit?: number; newestFirst?: boolean } = {},
): Promise<ChargeRow[]> {
  const like = opts.q ? `%${opts.q.replace(/[%_\\]/g, "\\$&")}%` : null;
  const rows = await db
    .select({
      id: charges.id,
      ownerId: charges.ownerId,
      ownerName: owners.displayName,
      contractId: charges.contractId,
      contractNumber: contracts.number,
      kind: charges.kind,
      description: charges.description,
      issueDate: charges.issueDate,
      dueDate: charges.dueDate,
      netCents: charges.netCents,
      vatRate: charges.vatRate,
      vatCents: charges.vatCents,
      grossCents: charges.grossCents,
      paidCents: paidExpr,
      cancelledAt: charges.cancelledAt,
    })
    .from(charges)
    .innerJoin(owners, eq(owners.id, charges.ownerId))
    .leftJoin(contracts, eq(contracts.id, charges.contractId))
    .leftJoin(paidByCharge, eq(paidByCharge.chargeId, charges.id))
    .where(
      and(
        eq(charges.marinaId, marinaId),
        opts.ownerId ? eq(charges.ownerId, opts.ownerId) : undefined,
        opts.contractId ? eq(charges.contractId, opts.contractId) : undefined,
        like ? or(ilike(owners.displayName, like), ilike(charges.description, like)) : undefined,
        filterSql(opts.filter ?? "tutti", today),
      ),
    )
    .orderBy(opts.newestFirst ? desc(charges.dueDate) : asc(charges.dueDate), asc(charges.createdAt))
    .limit(opts.limit ?? 500);

  return rows.map((r) => ({ ...r, status: chargeStatus(r, r.paidCents, today) }));
}

// Totali per le schede dello scadenziario.
export async function chargeTotals(marinaId: string, today: string) {
  const [row] = await db
    .select({
      openCents: sql<number>`coalesce(sum(${charges.grossCents} - coalesce(${paidByCharge.paid}, 0)) filter (where ${charges.grossCents} > coalesce(${paidByCharge.paid}, 0)), 0)::int`,
      openCount: sql<number>`count(*) filter (where ${charges.grossCents} > coalesce(${paidByCharge.paid}, 0))::int`,
      overdueCents: sql<number>`coalesce(sum(${charges.grossCents} - coalesce(${paidByCharge.paid}, 0)) filter (where ${charges.grossCents} > coalesce(${paidByCharge.paid}, 0) and ${charges.dueDate} < ${today}), 0)::int`,
      overdueCount: sql<number>`count(*) filter (where ${charges.grossCents} > coalesce(${paidByCharge.paid}, 0) and ${charges.dueDate} < ${today})::int`,
    })
    .from(charges)
    .leftJoin(paidByCharge, eq(paidByCharge.chargeId, charges.id))
    .where(and(eq(charges.marinaId, marinaId), sql`${charges.cancelledAt} is null`));
  return row;
}
