"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { createSession, destroySession, setSessionMarina } from "@/lib/auth/session";
import { homeFor, requireUser } from "@/lib/context";
import { todayRome, yearOf } from "@/lib/dates";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { createAccount, requestPasswordReset as sendPasswordReset, verifyLogin } from "./credentials";
import { createMarinaWithDefaults } from "./marina-setup";

function signupAllowed(): boolean {
  return process.env.ALLOW_SIGNUP !== "false";
}

// Freno ai tentativi di accesso ripetuti. È in memoria: vale per singola istanza del server.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

function tooManyAttempts(key: string): boolean {
  const entry = attempts.get(key);
  return !!entry && entry.resetAt > Date.now() && entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
}

const loginSchema = z.object({ email: f.email(), password: f.text("Inserisci la password") });

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(loginSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { email, password } = parsed.data;

  if (tooManyAttempts(email)) return fail("Troppi tentativi. Riprova tra qualche minuto.");

  const result = await verifyLogin(email, password);
  if (!result.ok) {
    if (result.reason === "credentials") {
      recordFailure(email);
      return fail("Email o password non corretti.");
    }
    if (result.reason === "disabled") return fail("Questo account è stato disattivato. Rivolgiti alla direzione del porto.");
    if (result.reason === "throttled") return fail("Troppi tentativi. Riprova tra qualche minuto, oppure scegli una nuova password con «Password dimenticata?».");
    return fail("Il servizio di accesso non risponde. Riprova tra qualche minuto.");
  }
  attempts.delete(email);

  const mems = await db.select({ marinaId: memberships.marinaId, role: memberships.role }).from(memberships).where(eq(memberships.userId, result.userId));
  await createSession(result.userId, mems.length === 1 ? mems[0].marinaId : null);
  redirect(mems.length === 1 ? homeFor(mems[0].role) : "/porti");
}

// Freno alle richieste di «password dimenticata»: al massimo 3 email per indirizzo ogni 15 minuti.
const resetRequests = new Map<string, { count: number; resetAt: number }>();

const resetSchema = z.object({ email: f.email() });

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(resetSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { email } = parsed.data;
  const now = Date.now();
  const entry = resetRequests.get(email);
  if (!entry || entry.resetAt <= now) resetRequests.set(email, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
  if ((resetRequests.get(email)?.count ?? 0) <= 3) await sendPasswordReset(email);
  // Stessa risposta in ogni caso: non si rivela se l'email ha un account.
  return {
    ok: true,
    message: "Se l'indirizzo ha un account, tra poco riceverai un'email con il collegamento per scegliere una nuova password. Controlla anche la posta indesiderata.",
  };
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

const registerSchema = z.object({
  marinaName: f.text("Inserisci il nome del porto"),
  name: f.text("Inserisci il tuo nome"),
  email: f.email(),
  password: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().min(10, "Almeno 10 caratteri").max(200)),
});

export async function register(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!signupAllowed()) return fail("La registrazione di nuovi porti non è attiva.");
  const parsed = parseForm(registerSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { marinaName, name, email, password } = parsed.data;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return fail("Controlla i campi evidenziati.", { email: "Esiste già un account con questa email: accedi." });

  let created: { userId: string; marinaId: string };
  try {
    created = await db.transaction(async (tx) => {
      const userId = await createAccount(tx, { email, name, password });
      const marinaId = await createMarinaWithDefaults(tx, { name: marinaName, userId, year: yearOf(todayRome()) });
      return { userId, marinaId };
    });
  } catch (error) {
    console.error("Registrazione non riuscita", error);
    return fail("Il servizio di accesso non risponde: riprova tra qualche minuto.");
  }
  const { userId, marinaId } = created;

  await createSession(userId, marinaId);
  redirect("/impostazioni/pontili?benvenuto=1");
}

export async function selectMarina(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser();
  const marinaId = String(formData.get("marinaId") ?? "");
  const membership = ctx.memberships.find((m) => m.marinaId === marinaId);
  if (!membership) return fail("Non hai accesso a questo porto.");
  await setSessionMarina(ctx.sessionId, marinaId);
  redirect(homeFor(membership.role));
}

const newMarinaSchema = z.object({ marinaName: f.text("Inserisci il nome del porto") });

export async function createMarina(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser();
  if (!signupAllowed()) return fail("La creazione di nuovi porti non è attiva.");
  const parsed = parseForm(newMarinaSchema, formData);
  if (!parsed.ok) return parsed.state;

  const marinaId = await db.transaction((tx) =>
    createMarinaWithDefaults(tx, { name: parsed.data.marinaName, userId: ctx.user.id, year: yearOf(todayRome()) }),
  );
  await setSessionMarina(ctx.sessionId, marinaId);
  redirect("/impostazioni/pontili?benvenuto=1");
}
