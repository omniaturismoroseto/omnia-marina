import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { berths, pierSections, piers } from "@/db/schema";
import { appendPositions } from "@/lib/pier-merge";
import { DomainError } from "./errors";

type PierRow = typeof piers.$inferSelect;

const NO_TRACE = { planAx: null, planAy: null, planBx: null, planBy: null };

export interface MergeResult {
  target: { id: string; code: string; name: string };
  merged: { id: string; code: string; name: string }[];
  moved: number;
}

/**
 * Unisce i pontili `sourceIds` in `targetId`, tutti del porto `marinaId`. Per la gestione resta un pontile solo: i posti passano
 * al pontile che resta (con codici, misure e contratti) e i pontili uniti si eliminano (con i loro prezzi: chi ha lo stesso nome
 * condivide già quelli del pontile che resta). Sulla pianta invece ogni pontile di prima diventa un tratto (pier_sections) con la
 * sua linea e i suoi posti, che nell'editor si sposta, ruota e traccia da solo.
 */
export async function mergePiers(tx: Tx, marinaId: string, targetId: string, sourceIds: string[]): Promise<MergeResult> {
  const sources = [...new Set(sourceIds)].filter((id) => id !== targetId);
  if (sources.length === 0) throw new DomainError("Scegli almeno un pontile da unire.");
  const rows = await tx
    .select()
    .from(piers)
    .where(and(eq(piers.marinaId, marinaId), inArray(piers.id, [targetId, ...sources])))
    .for("update");
  const target = rows.find((p) => p.id === targetId);
  if (!target || rows.length !== sources.length + 1) throw new DomainError("Pontile non trovato.");

  const [berthRows, sectionRows] = await Promise.all([
    tx
      .select({ id: berths.id, pierId: berths.pierId, sectionId: berths.sectionId, side: berths.side, position: berths.position })
      .from(berths)
      .where(and(eq(berths.marinaId, marinaId), inArray(berths.pierId, [targetId, ...sources]))),
    tx
      .select({ id: pierSections.id, pierId: pierSections.pierId, sortOrder: pierSections.sortOrder })
      .from(pierSections)
      .where(and(eq(pierSections.marinaId, marinaId), inArray(pierSections.pierId, [targetId, ...sources]))),
  ]);
  let order = sectionRows.filter((s) => s.pierId === targetId).reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;

  // La parte di un pontile che segue la sua linea (posti senza tratto) diventa un tratto con quella linea.
  async function sectionFromPier(pier: PierRow): Promise<void> {
    const loose = berthRows.filter((b) => b.pierId === pier.id && !b.sectionId);
    const hasTrace = pier.planAx !== null && pier.planAy !== null && pier.planBx !== null && pier.planBy !== null;
    if (loose.length === 0 && !hasTrace) return;
    const [section] = await tx
      .insert(pierSections)
      .values({
        marinaId,
        pierId: targetId,
        label: pier.code,
        sortOrder: order++,
        planAx: pier.planAx,
        planAy: pier.planAy,
        planBx: pier.planBx,
        planBy: pier.planBy,
        planWidthM: pier.planWidthM,
      })
      .returning({ id: pierSections.id });
    await tx
      .update(berths)
      .set({ sectionId: section.id })
      .where(and(eq(berths.marinaId, marinaId), eq(berths.pierId, pier.id), isNull(berths.sectionId)));
  }

  // Il pontile che resta: alla prima unione anche lui diventa un tratto, e la linea passa al tratto.
  if (!sectionRows.some((s) => s.pierId === targetId)) {
    await sectionFromPier(target);
    await tx.update(piers).set(NO_TRACE).where(eq(piers.id, targetId));
  }

  const kept = berthRows.filter((b) => b.pierId === targetId);
  let moved = 0;
  const merged: MergeResult["merged"] = [];
  // Nell'ordine dei pontili: i posti del primo arrivano prima di quelli del secondo.
  const ordered = rows.filter((p) => p.id !== targetId).sort((p, q) => p.sortOrder - q.sortOrder || p.code.localeCompare(q.code));
  for (const source of ordered) {
    // Tratti di un pontile già unito in precedenza: passano così come sono.
    for (const s of sectionRows.filter((x) => x.pierId === source.id).sort((p, q) => p.sortOrder - q.sortOrder)) {
      await tx.update(pierSections).set({ pierId: targetId, sortOrder: order++ }).where(eq(pierSections.id, s.id));
    }
    await sectionFromPier(source);
    // Per la griglia della mappa (senza pianta) i posti proseguono, lato per lato, dopo quelli del pontile che resta.
    const incoming = berthRows.filter((b) => b.pierId === source.id);
    const positions = appendPositions(kept, incoming);
    for (const b of incoming) {
      const position = positions.get(b.id)!;
      await tx.update(berths).set({ pierId: targetId, position }).where(eq(berths.id, b.id));
      kept.push({ ...b, pierId: targetId, position });
    }
    moved += incoming.length;
    merged.push({ id: source.id, code: source.code, name: source.name });
  }

  await tx.delete(piers).where(and(eq(piers.marinaId, marinaId), inArray(piers.id, sources)));
  return { target: { id: target.id, code: target.code, name: target.name }, merged, moved };
}

/**
 * Fa dei posti scelti un tratto della pianta del pontile (per esempio in un pontile unito prima che esistessero i tratti):
 * nell'editor il tratto si sposta, ruota e traccia da solo. I tratti rimasti senza posti si eliminano.
 */
export async function sectionFromBerths(tx: Tx, marinaId: string, pierId: string, berthIds: string[], label: string): Promise<number> {
  if (berthIds.length === 0) throw new DomainError("Scegli almeno un posto.");
  const [pier] = await tx
    .select({ id: piers.id })
    .from(piers)
    .where(and(eq(piers.id, pierId), eq(piers.marinaId, marinaId)))
    .for("update");
  if (!pier) throw new DomainError("Pontile non trovato.");
  const picked = await tx
    .select({ id: berths.id, sectionId: berths.sectionId })
    .from(berths)
    .where(and(eq(berths.marinaId, marinaId), eq(berths.pierId, pierId), inArray(berths.id, berthIds)));
  if (picked.length === 0) throw new DomainError("Scegli almeno un posto.");

  const sections = await tx
    .select({ id: pierSections.id, sortOrder: pierSections.sortOrder })
    .from(pierSections)
    .where(and(eq(pierSections.marinaId, marinaId), eq(pierSections.pierId, pierId)));
  const [section] = await tx
    .insert(pierSections)
    .values({ marinaId, pierId, label, sortOrder: sections.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1 })
    .returning({ id: pierSections.id });
  await tx
    .update(berths)
    .set({ sectionId: section.id })
    .where(
      and(
        eq(berths.marinaId, marinaId),
        inArray(
          berths.id,
          picked.map((b) => b.id),
        ),
      ),
    );

  // I tratti da cui venivano i posti, se ora sono vuoti, non servono più.
  const left = [...new Set(picked.map((b) => b.sectionId).filter((id): id is string => id !== null))];
  for (const id of left) {
    const [still] = await tx.select({ id: berths.id }).from(berths).where(eq(berths.sectionId, id)).limit(1);
    if (!still) await tx.delete(pierSections).where(and(eq(pierSections.id, id), eq(pierSections.marinaId, marinaId)));
  }
  return picked.length;
}
