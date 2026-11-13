import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { berths, boats, charges, contracts, movements, owners, payments, tasks, users } from "@/db/schema";

// Incassato per addebito, da unire alle query sugli addebiti.
export const paidByCharge = db
  .select({ chargeId: payments.chargeId, paid: sql<number>`sum(${payments.amountCents})::int`.as("paid") })
  .from(payments)
  .groupBy(payments.chargeId)
  .as("paid_by_charge");

export interface DockRow {
  contractId: string;
  number: string;
  type: "annuale" | "stagionale" | "mensile" | "transito";
  presence: "atteso" | "in_porto" | "fuori" | "partito";
  startDate: string;
  endDate: string;
  notes: string | null;
  boatId: string;
  boatName: string;
  boatType: string;
  lengthCm: number;
  beamCm: number;
  draftCm: number | null;
  ownerName: string;
  ownerPhone: string | null;
  berthCode: string | null;
  berthId: string | null;
  dueCents: number;
}

// Contratti che interessano la banchina oggi: barche attese e barche presenti (in porto o fuori).
export async function getDockRows(marinaId: string, today: string): Promise<DockRow[]> {
  const due = db
    .select({
      contractId: charges.contractId,
      due: sql<number>`sum(${charges.grossCents} - coalesce(${paidByCharge.paid}, 0))::int`.as("due"),
    })
    .from(charges)
    .leftJoin(paidByCharge, eq(paidByCharge.chargeId, charges.id))
    .where(and(eq(charges.marinaId, marinaId), sql`${charges.cancelledAt} is null`, lte(charges.dueDate, today)))
    .groupBy(charges.contractId)
    .as("due_by_contract");

  return db
    .select({
      contractId: contracts.id,
      number: contracts.number,
      type: contracts.type,
      presence: contracts.presence,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      notes: contracts.notes,
      boatId: boats.id,
      boatName: boats.name,
      boatType: boats.type,
      lengthCm: boats.lengthCm,
      beamCm: boats.beamCm,
      draftCm: boats.draftCm,
      ownerName: owners.displayName,
      ownerPhone: owners.phone,
      berthCode: berths.code,
      berthId: berths.id,
      dueCents: sql<number>`coalesce(${due.due}, 0)::int`,
    })
    .from(contracts)
    .innerJoin(boats, eq(boats.id, contracts.boatId))
    .innerJoin(owners, eq(owners.id, contracts.ownerId))
    .leftJoin(berths, eq(berths.id, contracts.berthId))
    .leftJoin(due, eq(due.contractId, contracts.id))
    .where(
      and(
        eq(contracts.marinaId, marinaId),
        eq(contracts.status, "attivo"),
        or(and(eq(contracts.presence, "atteso"), lte(contracts.startDate, today)), inArray(contracts.presence, ["in_porto", "fuori"])),
      ),
    )
    .orderBy(asc(berths.code), asc(boats.name));
}

export async function getOpenTasks(marinaId: string) {
  return db
    .select({
      id: tasks.id,
      kind: tasks.kind,
      priority: tasks.priority,
      status: tasks.status,
      title: tasks.title,
      description: tasks.description,
      createdAt: tasks.createdAt,
      berthCode: berths.code,
      boatName: boats.name,
      createdByName: users.name,
    })
    .from(tasks)
    .leftJoin(berths, eq(berths.id, tasks.berthId))
    .leftJoin(boats, eq(boats.id, tasks.boatId))
    .leftJoin(users, eq(users.id, tasks.createdBy))
    .where(and(eq(tasks.marinaId, marinaId), ne(tasks.status, "chiusa")))
    .orderBy(sql`case ${tasks.priority} when 'alta' then 0 when 'normale' then 1 else 2 end`, desc(tasks.createdAt));
}

export async function getRecentMovements(marinaId: string, since: Date, limit = 30) {
  return db
    .select({
      id: movements.id,
      kind: movements.kind,
      at: movements.at,
      note: movements.note,
      boatId: boats.id,
      boatName: boats.name,
      berthCode: berths.code,
      userName: users.name,
    })
    .from(movements)
    .innerJoin(boats, eq(boats.id, movements.boatId))
    .leftJoin(berths, eq(berths.id, movements.berthId))
    .leftJoin(users, eq(users.id, movements.userId))
    .where(and(eq(movements.marinaId, marinaId), gte(movements.at, since)))
    .orderBy(desc(movements.at))
    .limit(limit);
}
