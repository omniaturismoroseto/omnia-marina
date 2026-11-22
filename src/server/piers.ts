import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { berths, piers } from "@/db/schema";
import { appendPositions, mergeTraces, type PierTrace } from "@/lib/pier-merge";
import { DomainError } from "./errors";

type PierRow = typeof piers.$inferSelect;

function traceOf(p: PierRow): PierTrace | null {
  return p.planAx !== null && p.planAy !== null && p.planBx !== null && p.planBy !== null
    ? { a: { x: p.planAx, y: p.planAy }, b: { x: p.planBx, y: p.planBy }, widthM: p.planWidthM ?? 2 }
    : null;
}

export interface MergeResult {
  target: { id: string; code: string; name: string };
  merged: { id: string; code: string; name: string }[];
  moved: number;
  /** Falso se le linee tracciate sulla pianta non erano in linea: resta solo quella del pontile che rimane. */
  aligned: boolean;
}

/**
 * Unisce i pontili `sourceIds` in `targetId`, tutti del porto `marinaId`: i posti passano al pontile che resta (con codici,
 * misure, contratti e posizione sulla foto), sui due lati dopo quelli che ha già; la linea della pianta si allunga se i tratti
 * sono in linea; i pontili uniti si eliminano (con i loro prezzi: chi ha lo stesso nome condivide già quelli del pontile che resta).
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

  const berthRows = await tx
    .select({ id: berths.id, pierId: berths.pierId, side: berths.side, position: berths.position })
    .from(berths)
    .where(and(eq(berths.marinaId, marinaId), inArray(berths.pierId, [targetId, ...sources])));

  const kept = berthRows.filter((b) => b.pierId === targetId);
  let trace = traceOf(target);
  let aligned = true;
  let moved = 0;
  const merged: MergeResult["merged"] = [];
  // Nell'ordine dei pontili: i posti del primo arrivano prima di quelli del secondo.
  const ordered = rows.filter((p) => p.id !== targetId).sort((p, q) => p.sortOrder - q.sortOrder || p.code.localeCompare(q.code));
  for (const source of ordered) {
    const incoming = berthRows.filter((b) => b.pierId === source.id);
    const positions = appendPositions(kept, incoming);
    for (const b of incoming) {
      const position = positions.get(b.id)!;
      await tx.update(berths).set({ pierId: targetId, position }).where(eq(berths.id, b.id));
      kept.push({ ...b, pierId: targetId, position });
    }
    moved += incoming.length;
    const next = mergeTraces(trace, traceOf(source));
    trace = next.trace;
    aligned &&= next.aligned;
    merged.push({ id: source.id, code: source.code, name: source.name });
  }

  await tx
    .update(piers)
    .set({
      planAx: trace?.a.x ?? null,
      planAy: trace?.a.y ?? null,
      planBx: trace?.b.x ?? null,
      planBy: trace?.b.y ?? null,
      planWidthM: trace ? trace.widthM : target.planWidthM,
    })
    .where(eq(piers.id, targetId));
  await tx.delete(piers).where(and(eq(piers.marinaId, marinaId), inArray(piers.id, sources)));
  return { target: { id: target.id, code: target.code, name: target.name }, merged, moved, aligned };
}
