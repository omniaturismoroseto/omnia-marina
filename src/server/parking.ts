import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { contractItems, contracts, owners, parkingSpaces } from "@/db/schema";
import { compareCodes } from "@/lib/berth-codes";
import type { ContractItemInput } from "@/lib/contract-items";
import { formatDate } from "@/lib/dates";
import { DomainError } from "./errors";

// Posti auto della mappa assegnati nelle voci «posto auto» dei contratti. Un posto auto è impegnato da una voce di un contratto
// attivo o concluso nel suo periodo (date comprese); le bozze non lo impegnano, come per i posti barca.

export const PARKING_KINDS = ["auto_coperto", "auto_scoperto"] as const;
export type ParkingKind = (typeof PARKING_KINDS)[number];

export const isParkingKind = (kind: string): kind is ParkingKind => (PARKING_KINDS as readonly string[]).includes(kind);

/** Un posto auto con, se nel periodo è già assegnato, a chi. */
export interface ParkingOption {
  id: string;
  code: string;
  covered: boolean;
  active: boolean;
  onPlan: boolean;
  takenBy: { contractId: string; number: string | null; ownerName: string; startDate: string; endDate: string } | null;
}

/** Voci di contratti attivi o conclusi che impegnano i posti auto nel periodo da `from` a `to` (date comprese). */
async function busyItems(tx: Tx | typeof db, marinaId: string, from: string, to: string, excludeContractId?: string | null, spaceIds?: string[]) {
  return tx
    .select({
      spaceId: contractItems.parkingSpaceId,
      contractId: contracts.id,
      number: contracts.number,
      ownerName: owners.displayName,
      startDate: contractItems.startDate,
      endDate: contractItems.endDate,
    })
    .from(contractItems)
    .innerJoin(contracts, eq(contracts.id, contractItems.contractId))
    .innerJoin(owners, eq(owners.id, contracts.ownerId))
    .where(
      and(
        eq(contractItems.marinaId, marinaId),
        isNotNull(contractItems.parkingSpaceId),
        spaceIds ? inArray(contractItems.parkingSpaceId, spaceIds) : undefined,
        inArray(contracts.status, ["attivo", "concluso"]),
        lte(contractItems.startDate, to),
        gte(contractItems.endDate, from),
        excludeContractId ? ne(contracts.id, excludeContractId) : undefined,
      ),
    );
}

/** Tutti i posti auto del porto, in ordine di codice, con chi li ha già nel periodo. */
export async function parkingOptions(marinaId: string, from: string, to: string, excludeContractId?: string | null): Promise<ParkingOption[]> {
  const [spaces, busy] = await Promise.all([
    db
      .select({ id: parkingSpaces.id, code: parkingSpaces.code, covered: parkingSpaces.covered, active: parkingSpaces.active, x: parkingSpaces.planX })
      .from(parkingSpaces)
      .where(eq(parkingSpaces.marinaId, marinaId))
      .orderBy(asc(parkingSpaces.code)),
    busyItems(db, marinaId, from, to, excludeContractId),
  ]);
  return spaces
    .sort((a, b) => compareCodes(a.code, b.code))
    .map((s) => {
      const b = busy.find((x) => x.spaceId === s.id);
      return {
        id: s.id,
        code: s.code,
        covered: s.covered,
        active: s.active,
        onPlan: s.x !== null,
        takenBy: b ? { contractId: b.contractId, number: b.number, ownerName: b.ownerName, startDate: b.startDate!, endDate: b.endDate! } : null,
      };
    });
}

/**
 * Prepara le voci con un posto auto della mappa: il posto è del porto e del tipo giusto (coperto o scoperto), il codice va nel
 * riferimento della voce (com'è oggi, per la stampa) e due voci dello stesso contratto non si sovrappongono sullo stesso posto.
 * Con `occupy` (contratto attivo) il posto dev'essere anche in servizio e libero nel periodo, escluso il contratto stesso.
 */
export async function resolveParkingItems<T extends ContractItemInput>(
  tx: Tx,
  marinaId: string,
  items: T[],
  options: { occupy: boolean; contractId?: string | null },
): Promise<T[]> {
  const ids = [...new Set(items.flatMap((i) => (i.parkingSpaceId ? [i.parkingSpaceId] : [])))];
  if (ids.length === 0) return items;
  const spaces = await tx
    .select()
    .from(parkingSpaces)
    .where(and(eq(parkingSpaces.marinaId, marinaId), inArray(parkingSpaces.id, ids)));
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const result = items.map((item) => {
    if (!item.parkingSpaceId) return item;
    const space = byId.get(item.parkingSpaceId);
    if (!space) throw new DomainError("Posto auto non trovato.", "parkingSpaceId");
    if (!isParkingKind(item.kind)) throw new DomainError("Un posto auto della mappa va solo nelle voci «posto auto».", "parkingSpaceId");
    if ((item.kind === "auto_coperto") !== space.covered) {
      throw new DomainError(`Il posto auto ${space.code} è ${space.covered ? "coperto" : "scoperto"}: sceglilo nella voce giusta.`, "parkingSpaceId");
    }
    return { ...item, reference: space.code };
  });
  // Stesso posto due volte nello stesso contratto, con periodi che si toccano.
  const withSpace = result.filter((i) => i.parkingSpaceId);
  for (let i = 0; i < withSpace.length; i++) {
    for (let j = i + 1; j < withSpace.length; j++) {
      const a = withSpace[i];
      const b = withSpace[j];
      if (a.parkingSpaceId === b.parkingSpaceId && a.startDate! <= b.endDate! && b.startDate! <= a.endDate!) {
        throw new DomainError(`Il posto auto ${a.reference} compare due volte nello stesso periodo.`, "parkingSpaceId");
      }
    }
  }
  if (options.occupy) await assertParkingFree(tx, marinaId, result, options.contractId ?? null);
  return result;
}

/** I posti auto delle voci sono in servizio e liberi nel loro periodo (escluso il contratto stesso). */
export async function assertParkingFree(tx: Tx, marinaId: string, items: ContractItemInput[], contractId: string | null) {
  for (const item of items) {
    if (!item.parkingSpaceId || !item.startDate || !item.endDate) continue;
    const [space] = await tx.select().from(parkingSpaces).where(and(eq(parkingSpaces.id, item.parkingSpaceId), eq(parkingSpaces.marinaId, marinaId)));
    if (!space) throw new DomainError("Posto auto non trovato.", "parkingSpaceId");
    if (!space.active) throw new DomainError(`Il posto auto ${space.code} è fuori servizio.`, "parkingSpaceId");
    const [busy] = await busyItems(tx, marinaId, item.startDate, item.endDate, contractId, [space.id]);
    if (busy) {
      throw new DomainError(
        `Il posto auto ${space.code} è già assegnato a ${busy.ownerName}${busy.number ? ` (contratto ${busy.number})` : ""} dal ${formatDate(busy.startDate!)} al ${formatDate(busy.endDate!)}.`,
        "parkingSpaceId",
      );
    }
  }
}
