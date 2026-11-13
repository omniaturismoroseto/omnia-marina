import "server-only";
import { db, type Tx } from "@/db";
import { auditLog } from "@/db/schema";
import type { MarinaContext } from "./context";

export async function audit(
  ctx: Pick<MarinaContext, "marinaId" | "user">,
  action: string,
  entity: string,
  entityId: string | null,
  summary?: string,
  tx: Tx | typeof db = db,
): Promise<void> {
  await tx.insert(auditLog).values({ marinaId: ctx.marinaId, userId: ctx.user.id, action, entity, entityId, summary });
}
