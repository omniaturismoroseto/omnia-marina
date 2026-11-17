import "server-only";
import { db, type Tx } from "@/db";
import { auditLog } from "@/db/schema";

export async function audit(
  // Chi agisce: il personale del porto o, nell'area diportista, il diportista stesso.
  ctx: { marinaId: string; user: { id: string } },
  action: string,
  entity: string,
  entityId: string | null,
  summary?: string,
  tx: Tx | typeof db = db,
): Promise<void> {
  await tx.insert(auditLog).values({ marinaId: ctx.marinaId, userId: ctx.user.id, action, entity, entityId, summary });
}
