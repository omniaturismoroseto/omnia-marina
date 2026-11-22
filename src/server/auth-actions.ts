"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { isAccountManagerEmail } from "@/lib/account-manager";
import { audit } from "@/lib/audit";
import { createSession, destroySession, setSessionMarina, setSessionOwnerArea } from "@/lib/auth/session";
import { homeFor, ownerAreasFor, requireUser } from "@/lib/context";
import { todayRome, yearOf } from "@/lib/dates";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { createRateLimiter } from "@/lib/rate-limit";
import { createAccount, isEmailVerified, requestPasswordReset as sendPasswordReset, sendVerificationEmail, verifyLogin } from "./credentials";
import { DomainError, toFormState } from "./errors";
import { createMarinaWithDefaults, firstInstall } from "./marina-setup";
import { touchAccess } from "./owner-access";


const WINDOW_MS = 15 * 60 * 1000;
// Freno ai tentativi di accesso ripetuti: al massimo 8 password sbagliate per email ogni 15 minuti.
const loginFailures = createRateLimiter(8, WINDOW_MS);
// Freno alle richieste di «password dimenticata»: al massimo 3 email per indirizzo ogni 15 minuti.
const resetRequests = createRateLimiter(3, WINDOW_MS);

const loginSchema = z.object({ email: f.email(), password: f.text("Inserisci la password") });

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(loginSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { email, password } = parsed.data;

  if (loginFailures.blocked(email)) return fail("Troppi tentativi. Riprova tra qualche minuto.");

  const result = await verifyLogin(email, password);
  if (!result.ok) {
    if (result.reason === "credentials") {
      loginFailures.hit(email);
      return fail("Email o password non corretti.");
    }
    if (result.reason === "disabled") return fail("Questo account è stato disattivato. Rivolgiti alla direzione del porto.");
    if (result.reason === "throttled") return fail("Troppi tentativi. Riprova tra qualche minuto, oppure scegli una nuova password con «Password dimenticata?».");
    return fail("Il servizio di accesso non risponde. Riprova tra qualche minuto.");
  }
  loginFailures.clear(email);

  const userId = result.userId;
  // L'account manager sceglie sempre dove entrare, tra tutti i porti.
  if (isAccountManagerEmail(email)) {
    await createSession(userId, null);
    redirect("/porti");
  }
  const [mems, areas] = await Promise.all([
    db.select({ marinaId: memberships.marinaId, role: memberships.role }).from(memberships).where(eq(memberships.userId, userId)),
    ownerAreasFor(userId),
  ]);

  // L'area diportista si apre solo con l'email confermata: se manca, si rimanda il collegamento.
  if (areas.length > 0 && !(await isEmailVerified(userId))) {
    await sendVerificationEmail(email, password);
    if (mems.length === 0) {
      return fail(
        `Prima di entrare conferma la tua email: ti abbiamo mandato di nuovo il collegamento a ${email} (guarda anche nella posta indesiderata). Aperto il collegamento, torna qui e accedi.`,
      );
    }
  }

  if (mems.length === 0 && areas.length === 1) {
    await createSession(userId, areas[0].marinaId, areas[0].accessId);
    await touchAccess(areas[0].accessId);
    redirect("/diportista");
  }
  if (mems.length === 1 && areas.length === 0) {
    await createSession(userId, mems[0].marinaId);
    redirect(homeFor(mems[0].role));
  }
  await createSession(userId, null);
  redirect("/porti");
}

const resetSchema = z.object({ email: f.email() });

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(resetSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { email } = parsed.data;
  if (!resetRequests.blocked(email)) {
    resetRequests.hit(email);
    await sendPasswordReset(email);
  }
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
  if (!(await firstInstall())) return fail("I nuovi porti li crea Omnia Marina: chiedi il tuo accesso a chi ti ha proposto l'app.");
  const parsed = parseForm(registerSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { marinaName, name, email, password } = parsed.data;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return fail("Controlla i campi evidenziati.", { email: "Esiste già un account con questa email: accedi." });

  let created: { userId: string; marinaId: string };
  try {
    created = await db.transaction(async (tx) => {
      // Prima installazione: anche l'account manager può nascere da qui.
      const userId = await createAccount(tx, { email, name, password }, { allowAccountManager: true });
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

export async function selectOwnerArea(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser();
  const accessId = String(formData.get("accessId") ?? "");
  const area = ctx.ownerAreas.find((a) => a.accessId === accessId);
  if (!area) return fail("Non hai accesso a quest'area.");
  if (!(await isEmailVerified(ctx.user.id))) {
    return fail("Prima conferma la tua email con il collegamento che ti abbiamo mandato. Se non lo trovi, esci e rientra: te lo mandiamo di nuovo.");
  }
  await setSessionOwnerArea(ctx.sessionId, area.marinaId, area.accessId);
  await touchAccess(area.accessId);
  redirect("/diportista");
}

const newMarinaSchema = z.object({
  marinaName: f.text("Inserisci il nome del porto"),
  directorName: f.text("Inserisci nome e cognome del direttore"),
  directorEmail: f.email(),
  // Serve solo se l'email non ha ancora un account: chi ce l'ha entra con la password che già usa.
  password: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().max(200)),
});

/** Solo l'account manager: crea un porto con i dati di partenza e il suo direttore (ruolo Direzione). */
export async function createMarina(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser();
  if (!ctx.accountManager) return fail("I nuovi porti li crea solo Omnia Marina.");
  const parsed = parseForm(newMarinaSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { marinaName, directorName, directorEmail, password } = parsed.data;
  if (isAccountManagerEmail(directorEmail)) {
    return fail("Controlla i campi evidenziati.", { directorEmail: "Questa è un'email di Omnia Marina: indica quella del direttore del porto." });
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, directorEmail)).limit(1);
  if (!existing && password.length < 10) {
    return fail("Controlla i campi evidenziati.", { password: "Password provvisoria di almeno 10 caratteri" });
  }
  try {
    await db.transaction(async (tx) => {
      const directorId = existing?.id ?? (await createAccount(tx, { email: directorEmail, name: directorName, password }));
      const marinaId = await createMarinaWithDefaults(tx, { name: marinaName, userId: directorId, year: yearOf(todayRome()) });
      await audit({ marinaId, user: { id: ctx.user.id } }, "creazione", "porto", marinaId, `${marinaName} · direzione ${directorEmail}`, tx);
    });
  } catch (error) {
    if (error instanceof DomainError) return toFormState(error);
    console.error("Creazione del porto non riuscita", error);
    return fail("Il servizio di accesso non risponde: riprova tra qualche minuto.");
  }
  return {
    ok: true,
    message: existing
      ? `Porto «${marinaName}» creato. ${directorEmail} aveva già un account: entra con la password che già usa e lo trova tra i suoi porti.`
      : `Porto «${marinaName}» creato. Comunica al direttore l'indirizzo dell'app, l'email ${directorEmail} e la password provvisoria: potrà cambiarla dal proprio account.`,
  };
}
