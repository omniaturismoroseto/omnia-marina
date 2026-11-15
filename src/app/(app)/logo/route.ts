import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { marinaLogos, marinas } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMarina } from "@/lib/context";
import { checkLogo, LOGO_MAX_BYTES } from "@/lib/logo";
import { sameOrigin } from "@/lib/same-origin";

// Il logo della società di gestione: lo vedono tutti i ruoli (menu e stampe), lo carica e lo rimuove solo la direzione.

const fail = (status: number, message: string) => Response.json({ ok: false, message }, { status });

export async function GET() {
  const ctx = await requireMarina();
  const [logo] = await db.select().from(marinaLogos).where(eq(marinaLogos.marinaId, ctx.marinaId)).limit(1);
  if (!logo) return new Response("Nessun logo caricato", { status: 404 });
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mime,
      // L'indirizzo usato dalle pagine contiene la versione (?v=…), quindi la copia in cache non scade mai.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  const ctx = await requireMarina(["admin"]);
  if (!sameOrigin(request)) return fail(403, "Richiesta non valida.");
  if (Number(request.headers.get("content-length") ?? 0) > LOGO_MAX_BYTES) return fail(413, "Il logo è troppo pesante (massimo 2 MB).");

  const bytes = new Uint8Array(await request.arrayBuffer());
  const checked = checkLogo(bytes);
  if (!checked.ok) return fail(bytes.length > LOGO_MAX_BYTES ? 413 : 400, checked.message);
  const { info } = checked;

  await db.transaction(async (tx) => {
    const data = Buffer.from(bytes);
    await tx
      .insert(marinaLogos)
      .values({ marinaId: ctx.marinaId, mime: info.mime, data })
      .onConflictDoUpdate({ target: marinaLogos.marinaId, set: { mime: info.mime, data, updatedAt: new Date() } });
    await tx
      .update(marinas)
      .set({ logoWidth: info.width, logoHeight: info.height, logoVersion: sql`${marinas.logoVersion} + 1` })
      .where(eq(marinas.id, ctx.marinaId));
    await audit(ctx, "caricamento", "logo", ctx.marinaId, `Logo ${info.width} × ${info.height} px`, tx);
  });

  revalidatePath("/", "layout");
  return Response.json({ ok: true, width: info.width, height: info.height });
}

export async function DELETE(request: Request) {
  const ctx = await requireMarina(["admin"]);
  if (!sameOrigin(request)) return fail(403, "Richiesta non valida.");
  await db.transaction(async (tx) => {
    await tx.delete(marinaLogos).where(eq(marinaLogos.marinaId, ctx.marinaId));
    await tx
      .update(marinas)
      .set({ logoWidth: null, logoHeight: null, logoVersion: sql`${marinas.logoVersion} + 1` })
      .where(eq(marinas.id, ctx.marinaId));
    await audit(ctx, "rimozione", "logo", ctx.marinaId, undefined, tx);
  });
  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}
