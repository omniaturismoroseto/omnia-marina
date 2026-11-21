import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { marinaPlanBases, marinas } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMarina } from "@/lib/context";
import { imageInfo } from "@/lib/plan";
import { baseMatchesPhoto } from "@/lib/plan-base";
import { sameOrigin } from "@/lib/same-origin";

// La base disegnata dello schema: la vedono tutti i ruoli, la carica e la rimuove solo la direzione.

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 10000;

const fail = (status: number, message: string) => Response.json({ ok: false, message }, { status });

export async function GET() {
  const ctx = await requireMarina();
  const [base] = await db.select().from(marinaPlanBases).where(eq(marinaPlanBases.marinaId, ctx.marinaId)).limit(1);
  if (!base) return new Response("Nessuna base caricata", { status: 404 });
  return new Response(new Uint8Array(base.data), {
    headers: {
      "Content-Type": base.mime,
      // L'indirizzo usato dalle pagine contiene la versione (?v=…), quindi la copia in cache non scade mai.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  const ctx = await requireMarina(["admin"]);
  if (!sameOrigin(request)) return fail(403, "Richiesta non valida.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return fail(413, "L'immagine è troppo grande (massimo 15 MB).");

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) return fail(400, "Nessun file ricevuto.");
  if (bytes.length > MAX_BYTES) return fail(413, "L'immagine è troppo grande (massimo 15 MB).");

  // Il tipo si riconosce dal contenuto, non da quanto dichiara il browser: solo PNG e JPEG (mai SVG, che può contenere codice).
  const info = imageInfo(bytes);
  if (!info) return fail(400, "Il file non è un'immagine PNG o JPEG. Esporta la base in PNG.");
  if (Math.max(info.width, info.height) > MAX_SIDE) return fail(400, `L'immagine è troppo grande: al massimo ${MAX_SIDE} pixel per lato.`);

  const [marina] = await db.select({ width: marinas.planWidth, height: marinas.planHeight }).from(marinas).where(eq(marinas.id, ctx.marinaId));
  if (!marina?.width || !marina.height) return fail(400, "Carica prima la foto aerea: la base va disegnata ricalcandola.");
  if (!baseMatchesPhoto(info, { width: marina.width, height: marina.height })) {
    return fail(
      400,
      `La base deve avere le stesse proporzioni della foto aerea (${marina.width} × ${marina.height} pixel, o un multiplo): questa è ${info.width} × ${info.height}. Esportala senza ritagliare.`,
    );
  }

  const data = Buffer.from(bytes);
  await db
    .insert(marinaPlanBases)
    .values({ marinaId: ctx.marinaId, mime: info.mime, data, width: info.width, height: info.height })
    .onConflictDoUpdate({ target: marinaPlanBases.marinaId, set: { mime: info.mime, data, width: info.width, height: info.height, updatedAt: new Date() } });
  await audit(ctx, "caricamento", "base disegnata della mappa", ctx.marinaId, `${info.width} × ${info.height} px`);

  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const ctx = await requireMarina(["admin"]);
  if (!sameOrigin(request)) return fail(403, "Richiesta non valida.");
  await db.delete(marinaPlanBases).where(eq(marinaPlanBases.marinaId, ctx.marinaId));
  await audit(ctx, "rimozione", "base disegnata della mappa", ctx.marinaId);
  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}
