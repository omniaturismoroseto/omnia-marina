"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { EVERYONE, requireMarina, requireOwner } from "@/lib/context";
import { f, parseForm, type FormState } from "@/lib/forms";
import { toFormState } from "./errors";
import { markRead, sendMessage, type Audience } from "./messages";
import { removeSubscription, saveSubscription } from "./push";

const messageSchema = z.object({
  kind: f.choice(["urgente", "lavori", "info"] as const),
  title: f.text("Scrivi un titolo"),
  body: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(1, "Scrivi il messaggio").max(4000, "Al massimo 4000 caratteri")),
  audienceType: f.choice(["tutti", "pontile", "tipo", "in_porto", "cliente"] as const, "Scegli i destinatari"),
  pierId: f.optId(),
  // Presente solo quando si sceglie «Un tipo di contratto».
  contractType: z.preprocess((v) => (typeof v === "string" && v !== "" ? v : null), z.enum(["annuale", "stagionale", "mensile", "transito"]).nullable()),
  ownerId: f.optId(),
});

export async function sendMessageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(EVERYONE);
  const parsed = parseForm(messageSchema, formData);
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;

  let audience: Audience;
  if (d.audienceType === "pontile") {
    if (!d.pierId) return { message: "Controlla i campi evidenziati.", errors: { pierId: "Scegli il pontile" } };
    audience = { type: "pontile", pierId: d.pierId };
  } else if (d.audienceType === "tipo") {
    if (!d.contractType) return { message: "Controlla i campi evidenziati.", errors: { contractType: "Scegli il tipo di contratto" } };
    audience = { type: "tipo", contractType: d.contractType };
  } else if (d.audienceType === "cliente") {
    if (!d.ownerId) return { message: "Controlla i campi evidenziati.", errors: { ownerId: "Scegli il cliente" } };
    audience = { type: "cliente", ownerId: d.ownerId };
  } else {
    audience = { type: d.audienceType };
  }

  let sent: Awaited<ReturnType<typeof sendMessage>>;
  try {
    sent = await sendMessage(ctx, { kind: d.kind, title: d.title, body: d.body, audience });
  } catch (error) {
    return toFormState(error);
  }
  // Allerta vento inviata dal riquadro meteo: per 24 ore il pulsante diventa «Manda un altro avviso».
  if (formData.get("windAlert") === "1") {
    await db.update(marinas).set({ windAlertSentAt: new Date() }).where(eq(marinas.id, ctx.marinaId));
    revalidatePath("/");
    revalidatePath("/meteo");
    revalidatePath("/banchina");
  }
  revalidatePath("/messaggi");
  redirect(`/messaggi/${sent.messageId}?inviato=1`);
}

/** Il diportista ha aperto il messaggio. */
export async function markMessageRead(messageId: string): Promise<void> {
  const ctx = await requireOwner();
  if (!z.uuid().safeParse(messageId).success) return;
  await markRead({ marinaId: ctx.marinaId, ownerId: ctx.ownerId, userId: ctx.user.id }, messageId);
  revalidatePath("/diportista", "layout");
}

const subscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
});

/** Notifiche attivate su questo dispositivo. */
export async function savePushSubscription(input: unknown): Promise<boolean> {
  const ctx = await requireOwner();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.endpoint.startsWith("https://")) return false;
  await saveSubscription(ctx.user.id, parsed.data);
  return true;
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const ctx = await requireOwner();
  if (typeof endpoint === "string") await removeSubscription(ctx.user.id, endpoint);
}
