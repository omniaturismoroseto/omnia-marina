import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { boatPhotos, boats } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMarina, requireOwner, requireUser } from "@/lib/context";
import { BOAT_PHOTO_MAX_BYTES, checkBoatPhoto } from "@/lib/boat-photo";
import { uuidOrNull } from "@/lib/params";
import { sameOrigin } from "@/lib/same-origin";

// Foto della barca: la vede anche il diportista proprietario (solo le sue barche); la vedono, la caricano (anche scattandola col telefono in banchina) e la tolgono tutti i ruoli del porto.

type Params = { params: Promise<{ id: string }> };

const fail = (status: number, message: string) => Response.json({ ok: false, message }, { status });

function refresh(boatId: string) {
  revalidatePath(`/barche/${boatId}`);
  revalidatePath("/barche");
  revalidatePath("/mappa");
  revalidatePath("/banchina");
}

/** La barca indicata, solo se è del porto della sessione. */
async function boatOf(marinaId: string, params: Params["params"]) {
  const id = uuidOrNull((await params).id);
  if (!id) return null;
  const [boat] = await db
    .select({ id: boats.id, name: boats.name })
    .from(boats)
    .where(and(eq(boats.id, id), eq(boats.marinaId, marinaId)))
    .limit(1);
  return boat ?? null;
}

export async function GET(_request: Request, { params }: Params) {
  const id = uuidOrNull((await params).id);
  if (!id) return new Response("Foto non trovata", { status: 404 });
  // Il diportista vede solo le foto delle barche del cliente di cui ha l'accesso; il personale quelle del suo porto.
  const user = await requireUser();
  const owner = user.activeOwnerAccessId || user.previewOwnerId ? await requireOwner() : null;
  const marinaId = owner ? owner.marinaId : (await requireMarina()).marinaId;
  const [photo] = await db
    .select({ mime: boatPhotos.mime, data: boatPhotos.data })
    .from(boatPhotos)
    .innerJoin(boats, eq(boats.id, boatPhotos.boatId))
    .where(and(eq(boatPhotos.boatId, id), eq(boatPhotos.marinaId, marinaId), owner ? eq(boats.ownerId, owner.ownerId) : undefined))
    .limit(1);
  if (!photo) return new Response("Foto non trovata", { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.mime,
      // L'indirizzo usato dalle pagine contiene la versione (?v=…), quindi la copia in cache non scade mai.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request, { params }: Params) {
  const ctx = await requireMarina();
  if (!sameOrigin(request)) return fail(403, "Richiesta non valida.");
  const boat = await boatOf(ctx.marinaId, params);
  if (!boat) return fail(404, "Barca non trovata.");
  if (Number(request.headers.get("content-length") ?? 0) > BOAT_PHOTO_MAX_BYTES) return fail(413, "La foto è troppo pesante (massimo 3 MB).");

  const bytes = new Uint8Array(await request.arrayBuffer());
  const checked = checkBoatPhoto(bytes);
  if (!checked.ok) return fail(bytes.length > BOAT_PHOTO_MAX_BYTES ? 413 : 400, checked.message);
  const { info } = checked;

  await db.transaction(async (tx) => {
    const data = Buffer.from(bytes);
    await tx
      .insert(boatPhotos)
      .values({ boatId: boat.id, marinaId: ctx.marinaId, mime: info.mime, data })
      .onConflictDoUpdate({ target: boatPhotos.boatId, set: { mime: info.mime, data, updatedAt: new Date() } });
    await tx
      .update(boats)
      .set({ hasPhoto: true, photoVersion: sql`${boats.photoVersion} + 1` })
      .where(and(eq(boats.id, boat.id), eq(boats.marinaId, ctx.marinaId)));
    await audit(ctx, "caricamento", "foto barca", boat.id, `${boat.name}: ${info.width} × ${info.height} px`, tx);
  });

  refresh(boat.id);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: Params) {
  const ctx = await requireMarina();
  if (!sameOrigin(request)) return fail(403, "Richiesta non valida.");
  const boat = await boatOf(ctx.marinaId, params);
  if (!boat) return fail(404, "Barca non trovata.");
  await db.transaction(async (tx) => {
    await tx.delete(boatPhotos).where(and(eq(boatPhotos.boatId, boat.id), eq(boatPhotos.marinaId, ctx.marinaId)));
    await tx
      .update(boats)
      .set({ hasPhoto: false, photoVersion: sql`${boats.photoVersion} + 1` })
      .where(and(eq(boats.id, boat.id), eq(boats.marinaId, ctx.marinaId)));
    await audit(ctx, "rimozione", "foto barca", boat.id, boat.name, tx);
  });
  refresh(boat.id);
  return Response.json({ ok: true });
}
