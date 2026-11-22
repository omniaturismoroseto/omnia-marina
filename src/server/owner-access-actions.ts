"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession } from "@/lib/auth/session";
import { OFFICE, requireMarina } from "@/lib/context";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { toFormState } from "./errors";
import { activateInvite, cancelInvite, createInvite, renewInvite, revokeAccess, touchAccess } from "./owner-access";

// ───────────────────────── Ufficio: scheda cliente ─────────────────────────

const inviteSchema = z.object({ ownerId: f.id(), name: f.text("Scrivi il nome della persona da invitare") });

export async function createInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(inviteSchema, formData);
  if (!parsed.ok) return parsed.state;
  try {
    await createInvite(ctx, parsed.data.ownerId, parsed.data.name);
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/clienti/${parsed.data.ownerId}`);
  return { ok: true, message: "Invito creato: consegna il codice con il foglio di benvenuto o con un messaggio." };
}

const inviteIdSchema = z.object({ inviteId: f.id(), ownerId: f.id() });

export async function renewInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(inviteIdSchema, formData);
  if (!parsed.ok) return parsed.state;
  try {
    await renewInvite(ctx, parsed.data.inviteId);
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/clienti/${parsed.data.ownerId}`);
  return { ok: true };
}

export async function cancelInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(inviteIdSchema, formData);
  if (!parsed.ok) return parsed.state;
  try {
    await cancelInvite(ctx, parsed.data.inviteId);
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/clienti/${parsed.data.ownerId}`);
  return { ok: true };
}

const accessIdSchema = z.object({ accessId: f.id(), ownerId: f.id() });

export async function revokeAccessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(accessIdSchema, formData);
  if (!parsed.ok) return parsed.state;
  try {
    await revokeAccess(ctx, parsed.data.accessId);
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/clienti/${parsed.data.ownerId}`);
  return { ok: true };
}

// ───────────────────────── Diportista: attivazione ─────────────────────────

// Freno ai tentativi da uno stesso indirizzo: al massimo 10 ogni 15 minuti.
const tries = createRateLimiter(10, 15 * 60 * 1000);

async function clientKey(): Promise<string> {
  const h = await headers();
  return clientIp(h.get("x-forwarded-for"), h.get("x-real-ip"));
}

const activateSchema = z.object({
  code: f.text("Scrivi il codice di attivazione"),
  taxId: f.text("Scrivi il codice fiscale o la partita IVA"),
  email: f.email(),
  password: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().min(10, "Almeno 10 caratteri").max(200)),
});

export async function activateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(activateSchema, formData);
  if (!parsed.ok) return parsed.state;

  const key = await clientKey();
  if (tries.blocked(key)) return fail("Troppi tentativi. Riprova tra qualche minuto.");
  tries.hit(key);

  let result: Awaited<ReturnType<typeof activateInvite>>;
  try {
    result = await activateInvite(parsed.data);
  } catch (error) {
    console.error("Attivazione non riuscita", error);
    return fail("Il servizio di accesso non risponde. Riprova tra qualche minuto.");
  }
  if (!result.ok) return fail(result.message, result.field ? { [result.field]: result.message } : undefined);

  tries.clear(key);
  if (result.emailVerified) {
    await createSession(result.userId, result.marinaId, result.accessId);
    await touchAccess(result.accessId);
    redirect("/diportista");
  }
  redirect(result.verificationSent ? "/attiva/conferma" : "/attiva/conferma?invio=no");
}
