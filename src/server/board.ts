import "server-only";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { berthCategories, berths, boats, contracts, owners, piers, type BerthStatus, type ContractType, type Presence } from "@/db/schema";

/*
 * Stato di un posto barca in una data:
 * - libero        nessun contratto attivo copre la data
 * - occupato      barca in porto (o, per una data diversa da oggi, posto assegnato)
 * - fuori         posto assegnato, barca temporaneamente in mare
 * - atteso        posto assegnato, barca non ancora arrivata
 * - partenza      barca in porto con partenza prevista oggi
 * - ritardo       barca ancora in porto oltre la fine del contratto
 * - fermo         posto in manutenzione o fuori servizio
 */
export type BerthState = "libero" | "occupato" | "fuori" | "atteso" | "partenza" | "ritardo" | "fermo";

export interface Occupant {
  contractId: string;
  number: string | null;
  type: ContractType;
  presence: Presence;
  startDate: string;
  endDate: string;
  boatId: string;
  boatName: string;
  boatLengthCm: number;
  boatBeamCm: number;
  ownerId: string;
  ownerName: string;
  ownerPhone: string | null;
}

export interface BoardBerth {
  id: string;
  code: string;
  pierId: string;
  side: "sx" | "dx";
  position: number;
  lengthCm: number;
  beamCm: number;
  draftCm: number | null;
  hasWater: boolean;
  hasPower: boolean;
  status: BerthStatus;
  notes: string | null;
  categoryName: string | null;
  // Posizione sulla foto aerea (null se il posto non è ancora stato disposto sulla pianta).
  planX: number | null;
  planY: number | null;
  planAngle: number | null;
  state: BerthState;
  occupant: Occupant | null;
  // Barca in arrivo oggi su un posto che deve ancora liberarsi.
  incoming: Occupant | null;
}

export interface BoardPier {
  id: string;
  code: string;
  name: string;
  berths: BoardBerth[];
}

export async function getBoard(marinaId: string, date: string, today: string): Promise<BoardPier[]> {
  const isToday = date === today;

  const [pierRows, berthRows, contractRows] = await Promise.all([
    db.select().from(piers).where(eq(piers.marinaId, marinaId)).orderBy(asc(piers.sortOrder), asc(piers.code)),
    db
      .select({ berth: berths, categoryName: berthCategories.name })
      .from(berths)
      .leftJoin(berthCategories, eq(berthCategories.id, berths.categoryId))
      .where(eq(berths.marinaId, marinaId))
      .orderBy(asc(berths.position), asc(berths.code)),
    db
      .select({
        berthId: contracts.berthId,
        occupiedUntil: contracts.occupiedUntil,
        contractId: contracts.id,
        number: contracts.number,
        type: contracts.type,
        presence: contracts.presence,
        startDate: contracts.startDate,
        endDate: contracts.endDate,
        boatId: boats.id,
        boatName: boats.name,
        boatLengthCm: boats.lengthCm,
        boatBeamCm: boats.beamCm,
        ownerId: owners.id,
        ownerName: owners.displayName,
        ownerPhone: owners.phone,
      })
      .from(contracts)
      .innerJoin(boats, eq(boats.id, contracts.boatId))
      .innerJoin(owners, eq(owners.id, contracts.ownerId))
      .where(
        and(
          eq(contracts.marinaId, marinaId),
          eq(contracts.status, "attivo"),
          lte(contracts.startDate, date),
          or(
            sql`${contracts.occupiedUntil} > ${date}`,
            // Oggi contano anche le barche ancora fisicamente in porto a contratto finito.
            isToday ? sql`${contracts.presence} in ('in_porto', 'fuori')` : sql`false`,
          ),
        ),
      ),
  ]);

  const byBerth = new Map<string, typeof contractRows>();
  for (const row of contractRows) {
    if (!row.berthId) continue;
    const list = byBerth.get(row.berthId) ?? [];
    list.push(row);
    byBerth.set(row.berthId, list);
  }

  const result = pierRows.map((p) => ({ id: p.id, code: p.code, name: p.name, berths: [] as BoardBerth[] }));
  const pierIndex = new Map(result.map((p) => [p.id, p]));

  for (const { berth, categoryName } of berthRows) {
    const candidates = byBerth.get(berth.id) ?? [];
    const present = candidates.find((c) => c.presence === "in_porto" || c.presence === "fuori");
    const covering = candidates.find((c) => c.occupiedUntil > date);
    const current = isToday ? (present ?? covering) : covering;
    const incoming = isToday && present && covering && covering.contractId !== present.contractId ? covering : null;

    let state: BerthState = "libero";
    if (berth.status !== "attivo" && !current) state = "fermo";
    else if (current) {
      if (!isToday) state = "occupato";
      else if (current.presence === "atteso") state = "atteso";
      else if (current.occupiedUntil <= today) state = current.endDate < today ? "ritardo" : "partenza";
      else state = current.presence === "fuori" ? "fuori" : "occupato";
    }

    pierIndex.get(berth.pierId)?.berths.push({
      id: berth.id,
      code: berth.code,
      pierId: berth.pierId,
      side: berth.side,
      position: berth.position,
      lengthCm: berth.lengthCm,
      beamCm: berth.beamCm,
      draftCm: berth.draftCm,
      hasWater: berth.hasWater,
      hasPower: berth.hasPower,
      status: berth.status,
      notes: berth.notes,
      categoryName,
      planX: berth.planX,
      planY: berth.planY,
      planAngle: berth.planAngle,
      state,
      occupant: current ?? null,
      incoming,
    });
  }
  return result;
}

export function countStates(board: BoardPier[]): Record<BerthState, number> & { total: number } {
  const counts = { libero: 0, occupato: 0, fuori: 0, atteso: 0, partenza: 0, ritardo: 0, fermo: 0, total: 0 };
  for (const pier of board) {
    for (const b of pier.berths) {
      counts[b.state]++;
      counts.total++;
    }
  }
  return counts;
}

export const STATE_LABEL: Record<BerthState, string> = {
  libero: "Libero",
  occupato: "Occupato",
  fuori: "Barca fuori",
  atteso: "In arrivo",
  partenza: "In partenza",
  ritardo: "Oltre scadenza",
  fermo: "Non disponibile",
};
