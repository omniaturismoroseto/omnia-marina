import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { boats, contracts } from "@/db/schema";
import { DomainError } from "./errors";

// Archivio delle barche: fuori dall'elenco normale e dalle scelte dei nuovi contratti, ma con tutta la loro storia.
// Ci vanno a mano (barca venduta) o con il cliente quando diventa «ex cliente»; ne escono da sole con un contratto attivo.

export async function setBoatArchived(tx: Tx, marinaId: string, boatId: string, archived: boolean): Promise<{ name: string }> {
  const [boat] = await tx
    .select({ id: boats.id, name: boats.name })
    .from(boats)
    .where(and(eq(boats.id, boatId), eq(boats.marinaId, marinaId)))
    .limit(1);
  if (!boat) throw new DomainError("Barca non trovata.");
  if (archived) {
    const [active] = await tx
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.boatId, boatId), eq(contracts.marinaId, marinaId), eq(contracts.status, "attivo")))
      .limit(1);
    if (active) throw new DomainError("La barca ha un contratto attivo: si archivia solo quando il contratto è concluso o annullato.");
  }
  await tx
    .update(boats)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(boats.id, boatId));
  return { name: boat.name };
}

/** Il cliente diventa «ex cliente»: le sue barche vanno in archivio. Restituisce quante. */
export async function archiveOwnerBoats(tx: Tx, marinaId: string, ownerId: string): Promise<number> {
  const updated = await tx
    .update(boats)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(boats.ownerId, ownerId), eq(boats.marinaId, marinaId), isNull(boats.archivedAt)))
    .returning({ id: boats.id });
  return updated.length;
}

/** Contratto attivo per una barca in archivio: torna nell'elenco normale. */
export async function unarchiveBoat(tx: Tx, marinaId: string, boatId: string): Promise<void> {
  await tx
    .update(boats)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(boats.id, boatId), eq(boats.marinaId, marinaId), isNotNull(boats.archivedAt)));
}
