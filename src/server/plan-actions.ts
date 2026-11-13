"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMarina } from "@/lib/context";

const layoutSchema = z.object({
  pxPerMeter: z.number().positive().max(2000).nullable(),
  placements: z
    .array(
      z.object({
        id: z.uuid(),
        // null = posto tolto dalla pianta
        position: z.object({ x: z.number().finite(), y: z.number().finite(), angle: z.number().min(-360).max(360) }).nullable(),
      }),
    )
    .max(5000),
});

export type PlanLayoutInput = z.infer<typeof layoutSchema>;

// Salva la scala della foto e la posizione di tutti i posti disposti nell'editor della pianta.
export async function savePlanLayout(input: PlanLayoutInput): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireMarina(["admin"]);
  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dati della pianta non validi." };
  const { pxPerMeter, placements } = parsed.data;

  const [marina] = await db.select({ width: marinas.planWidth, height: marinas.planHeight }).from(marinas).where(eq(marinas.id, ctx.marinaId));
  if (!marina?.width || !marina.height) return { ok: false, message: "Carica prima la foto del porto." };

  // Un posto può sporgere un poco dal bordo della foto, ma non stare altrove.
  const margin = 0.1;
  const inside = (p: { x: number; y: number }) =>
    p.x >= -marina.width! * margin && p.x <= marina.width! * (1 + margin) && p.y >= -marina.height! * margin && p.y <= marina.height! * (1 + margin);
  if (placements.some((p) => p.position && !inside(p.position))) return { ok: false, message: "Alcuni posti sono fuori dalla foto." };

  await db.transaction(async (tx) => {
    await tx.update(marinas).set({ planPxPerMeter: pxPerMeter }).where(eq(marinas.id, ctx.marinaId));
    if (placements.length > 0) {
      const rows = sql.join(
        placements.map((p) => sql`(${p.id}::uuid, ${p.position?.x ?? null}::real, ${p.position?.y ?? null}::real, ${p.position?.angle ?? null}::real)`),
        sql`, `,
      );
      // Il filtro sul porto garantisce che non si possano spostare posti di altri porti.
      await tx.execute(sql`
        update berths set plan_x = v.x, plan_y = v.y, plan_angle = v.angle
        from (values ${rows}) as v(id, x, y, angle)
        where berths.id = v.id and berths.marina_id = ${ctx.marinaId}
      `);
    }
    const placed = placements.filter((p) => p.position).length;
    await audit(ctx, "modifica", "pianta del porto", ctx.marinaId, `${placed} posti disposti sulla foto`, tx);
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Pianta salvata." };
}
