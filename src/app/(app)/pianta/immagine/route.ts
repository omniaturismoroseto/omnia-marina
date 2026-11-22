import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { berths, marinaPlanBases, marinaPlans, marinas, pierSections, piers, planFeatures } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMarina } from "@/lib/context";
import { imageInfo } from "@/lib/plan";
import { sameOrigin } from "@/lib/same-origin";

// La foto aerea del porto: la vedono tutti i ruoli, la carica e la rimuove solo la direzione.

const MAX_BYTES = 8 * 1024 * 1024;
const MIN_SIDE = 300;
const MAX_SIDE = 6000;

const fail = (status: number, message: string) => Response.json({ ok: false, message }, { status });

export async function GET() {
  const ctx = await requireMarina();
  const [plan] = await db.select().from(marinaPlans).where(eq(marinaPlans.marinaId, ctx.marinaId)).limit(1);
  if (!plan) return new Response("Nessuna foto caricata", { status: 404 });
  return new Response(new Uint8Array(plan.data), {
    headers: {
      "Content-Type": plan.mime,
      // L'indirizzo usato dalle pagine contiene la versione (?v=…), quindi la copia in cache non scade mai.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  const ctx = await requireMarina(["admin"]);
  if (!sameOrigin(request)) return fail(403, "Richiesta non valida.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return fail(413, "La foto è troppo grande (massimo 8 MB).");

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) return fail(400, "Nessun file ricevuto.");
  if (bytes.length > MAX_BYTES) return fail(413, "La foto è troppo grande (massimo 8 MB).");

  // Il tipo si riconosce dal contenuto, non da quanto dichiara il browser.
  const info = imageInfo(bytes);
  if (!info) return fail(400, "Il file non è un'immagine JPEG o PNG.");
  if (Math.min(info.width, info.height) < MIN_SIDE) return fail(400, `L'immagine è troppo piccola: servono almeno ${MIN_SIDE} pixel per lato.`);
  if (Math.max(info.width, info.height) > MAX_SIDE) return fail(400, `L'immagine è troppo grande: al massimo ${MAX_SIDE} pixel per lato.`);

  const positionsReset = await db.transaction(async (tx) => {
    const [marina] = await tx
      .select({ width: marinas.planWidth, height: marinas.planHeight })
      .from(marinas)
      .where(eq(marinas.id, ctx.marinaId))
      .for("update");
    // Stesse dimensioni = stessa inquadratura (es. foto più nitida): le posizioni dei posti restano valide.
    const sameFrame = marina.width === info.width && marina.height === info.height;
    const data = Buffer.from(bytes);

    await tx
      .insert(marinaPlans)
      .values({ marinaId: ctx.marinaId, mime: info.mime, data })
      .onConflictDoUpdate({ target: marinaPlans.marinaId, set: { mime: info.mime, data, analysis: null, analyzedAt: null, updatedAt: new Date() } });
    await tx
      .update(marinas)
      .set({
        planWidth: info.width,
        planHeight: info.height,
        planVersion: sql`${marinas.planVersion} + 1`,
        ...(sameFrame ? {} : { planPxPerMeter: null }),
      })
      .where(eq(marinas.id, ctx.marinaId));
    if (!sameFrame) {
      // Inquadratura diversa: posti, linee dei pontili e sfondo della mappa non corrispondono più alla foto.
      await tx.update(berths).set({ planX: null, planY: null, planAngle: null }).where(eq(berths.marinaId, ctx.marinaId));
      await tx.update(piers).set({ planAx: null, planAy: null, planBx: null, planBy: null }).where(eq(piers.marinaId, ctx.marinaId));
      await tx.update(pierSections).set({ planAx: null, planAy: null, planBx: null, planBy: null }).where(eq(pierSections.marinaId, ctx.marinaId));
      await tx.delete(planFeatures).where(eq(planFeatures.marinaId, ctx.marinaId));
      await tx.delete(marinaPlanBases).where(eq(marinaPlanBases.marinaId, ctx.marinaId));
    }
    await audit(ctx, "caricamento", "pianta del porto", ctx.marinaId, `Foto ${info.width} × ${info.height} px`, tx);
    return !sameFrame && marina.width !== null;
  });

  revalidatePath("/", "layout");
  return Response.json({ ok: true, width: info.width, height: info.height, positionsReset });
}

export async function DELETE(request: Request) {
  const ctx = await requireMarina(["admin"]);
  if (!sameOrigin(request)) return fail(403, "Richiesta non valida.");
  await db.transaction(async (tx) => {
    await tx.delete(marinaPlans).where(eq(marinaPlans.marinaId, ctx.marinaId));
    await tx
      .update(marinas)
      .set({ planWidth: null, planHeight: null, planPxPerMeter: null, planVersion: sql`${marinas.planVersion} + 1` })
      .where(eq(marinas.id, ctx.marinaId));
    await tx.update(berths).set({ planX: null, planY: null, planAngle: null }).where(eq(berths.marinaId, ctx.marinaId));
    await tx.update(piers).set({ planAx: null, planAy: null, planBx: null, planBy: null }).where(eq(piers.marinaId, ctx.marinaId));
    await tx.update(pierSections).set({ planAx: null, planAy: null, planBx: null, planBy: null }).where(eq(pierSections.marinaId, ctx.marinaId));
    await tx.delete(planFeatures).where(eq(planFeatures.marinaId, ctx.marinaId));
    await tx.delete(marinaPlanBases).where(eq(marinaPlanBases.marinaId, ctx.marinaId));
    await audit(ctx, "rimozione", "pianta del porto", ctx.marinaId, undefined, tx);
  });
  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}
