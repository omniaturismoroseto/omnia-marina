import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { db, type Tx } from "@/db";
import { users } from "@/db/schema";
import { isAccountManagerEmail } from "@/lib/account-manager";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { DomainError } from "./errors";

// Email e password: dove si controllano e dove si cambiano.
//
// Con FIREBASE_PROJECT_ID impostato gli accessi passano da Firebase Authentication: Firebase custodisce le password e
// invia le email (password dimenticata). Senza, l'app usa le password salvate nel proprio database, come prima.
// Il passaggio è automatico: un account con la password locale va su Firebase al primo accesso riuscito (stessa
// password) o alla prima richiesta di «password dimenticata».

type Executor = typeof db | Tx;
type UserRow = typeof users.$inferSelect;

export type LoginResult = { ok: true; userId: string } | { ok: false; reason: "credentials" | "disabled" | "throttled" | "unavailable" };

export function firebaseEnabled(): boolean {
  return !!process.env.FIREBASE_PROJECT_ID;
}

// ───────────────────────── Firebase ─────────────────────────

function adminAuth(): Auth {
  // Su Cloud Run le credenziali sono quelle dell'account di servizio dell'app; con l'emulatore
  // (FIREBASE_AUTH_EMULATOR_HOST) non servono.
  const app: App = getApps()[0] ?? initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
  return getAuth(app);
}

// API REST di Firebase Authentication (accesso con password e invio delle email). La chiave web non è un segreto.
async function identityToolkit<T>(method: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; code: string }> {
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emulator ? `http://${emulator}/identitytoolkit.googleapis.com/v1` : "https://identitytoolkit.googleapis.com/v1";
  const key = process.env.FIREBASE_API_KEY ?? (emulator ? "emulatore" : "");
  try {
    const res = await fetch(`${base}/accounts:${method}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      // La lingua delle email inviate da Firebase.
      headers: { "Content-Type": "application/json", "X-Firebase-Locale": "it" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
    if (res.ok) return { ok: true, data: json };
    // Il codice è la prima parola del messaggio (es. "TOO_MANY_ATTEMPTS_TRY_LATER : ...").
    return { ok: false, code: (json.error?.message ?? `HTTP_${res.status}`).split(/[\s:]/)[0] };
  } catch (error) {
    console.error("Firebase Authentication non raggiungibile", error);
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export function loginFailure(code: string): Extract<LoginResult, { ok: false }>["reason"] {
  if (code === "USER_DISABLED") return "disabled";
  if (code === "TOO_MANY_ATTEMPTS_TRY_LATER") return "throttled";
  if (["EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS", "INVALID_EMAIL", "MISSING_PASSWORD"].includes(code)) return "credentials";
  return "unavailable";
}

function firebaseCode(error: unknown): string | undefined {
  return typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

/**
 * Crea (o recupera) l'account Firebase per l'email indicata e restituisce il suo uid. Se l'email esiste già su Firebase
 * senza un utente dell'app (ad esempio un salvataggio interrotto a metà), l'account viene ripreso e riceve la password.
 */
async function firebaseAccount(user: { id: string; email: string; name: string }, password: string): Promise<string> {
  const auth = adminAuth();
  try {
    const created = await auth.createUser({ uid: user.id, email: user.email, password, displayName: user.name });
    return created.uid;
  } catch (error) {
    if (firebaseCode(error) !== "auth/email-already-exists" && firebaseCode(error) !== "auth/uid-already-exists") throw error;
    const existing = await auth.getUserByEmail(user.email);
    const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, existing.uid)).limit(1);
    if (owner && owner.id !== user.id) throw new Error(`L'account Firebase di ${user.email} è già collegato a un altro utente.`);
    await auth.updateUser(existing.uid, { password, displayName: user.name });
    return existing.uid;
  }
}

// Porta su Firebase un utente che ha ancora la password locale.
async function moveToFirebase(user: UserRow, password: string): Promise<string> {
  const uid = await firebaseAccount(user, password);
  await db.update(users).set({ firebaseUid: uid, passwordHash: null }).where(eq(users.id, user.id));
  return uid;
}

async function userByEmail(email: string): Promise<UserRow | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}

// ───────────────────────── Operazioni ─────────────────────────

/** Controlla email e password. L'email arriva già in minuscolo. */
export async function verifyLogin(email: string, password: string): Promise<LoginResult> {
  const user = await userByEmail(email);

  if (!firebaseEnabled()) {
    if (user?.passwordHash && (await verifyPassword(password, user.passwordHash))) return { ok: true, userId: user.id };
    return { ok: false, reason: "credentials" };
  }

  // Non ancora passato a Firebase: vale la password locale, e se è giusta l'account si sposta.
  if (user && !user.firebaseUid) {
    if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) return { ok: false, reason: "credentials" };
    try {
      await moveToFirebase(user, password);
    } catch (error) {
      // Firebase non risponde: si entra lo stesso con la password locale e si riprova al prossimo accesso.
      console.error(`Spostamento su Firebase non riuscito per ${email}`, error);
    }
    return { ok: true, userId: user.id };
  }

  const res = await identityToolkit<{ localId: string }>("signInWithPassword", { email, password, returnSecureToken: true });
  if (!res.ok) {
    const reason = loginFailure(res.code);
    // Gli errori di configurazione (chiave web sbagliata, metodo email/password spento…) finiscono nel registro col loro codice.
    if (reason === "unavailable") console.error(`Accesso con Firebase non riuscito per ${email}: ${res.code}`);
    return { ok: false, reason };
  }
  // Solo gli account collegati a un utente dell'app entrano.
  const [linked] = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, res.data.localId)).limit(1);
  return linked ? { ok: true, userId: linked.id } : { ok: false, reason: "credentials" };
}

/** Crea un utente dell'app con la sua password (nuovo porto, nuovo collega, diportista). Restituisce l'id. */
export async function createAccount(
  tx: Executor,
  input: { email: string; name: string; password: string },
  options: { allowAccountManager?: boolean } = {},
): Promise<string> {
  // L'account manager si riconosce dall'email: un account nuovo con quell'email ne avrebbe i poteri. Solo la prima
  // installazione (nessun porto nel database) può crearlo.
  if (!options.allowAccountManager && isAccountManagerEmail(input.email)) throw new DomainError("Questa email non si può usare per un nuovo account.", "email");
  const id = randomUUID();
  if (!firebaseEnabled()) {
    await tx.insert(users).values({ id, email: input.email, name: input.name, passwordHash: await hashPassword(input.password) });
    return id;
  }
  const firebaseUid = await firebaseAccount({ id, email: input.email, name: input.name }, input.password);
  await tx.insert(users).values({ id, email: input.email, name: input.name, firebaseUid });
  return id;
}

/** Imposta una nuova password (password provvisoria della direzione, cambio dal proprio account). */
export async function setPassword(userId: string, password: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("Utente non trovato.");
  if (!firebaseEnabled()) {
    await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
  } else if (!user.firebaseUid) {
    await moveToFirebase(user, password);
  } else {
    await adminAuth().updateUser(user.firebaseUid, { password });
  }
}

/** Vero se la password è quella dell'utente (per confermare un cambio di password). */
export async function checkPassword(userId: string, password: string): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return false;
  if (!firebaseEnabled() || !user.firebaseUid) return !!user.passwordHash && verifyPassword(password, user.passwordHash);
  const res = await identityToolkit<{ localId: string }>("signInWithPassword", { email: user.email, password, returnSecureToken: true });
  return res.ok && res.data.localId === user.firebaseUid;
}

/**
 * Fa inviare da Firebase l'email per scegliere una nuova password. Non rivela mai se l'email esiste: gli errori
 * finiscono solo nel registro del server. Un account ancora locale passa prima su Firebase (con una password a caso,
 * che l'email sostituisce).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!firebaseEnabled()) return;
  const user = await userByEmail(email);
  if (!user) return;
  try {
    if (!user.firebaseUid) await moveToFirebase(user, randomBytes(24).toString("base64url"));
    const continueUrl = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}/login` : undefined;
    const res = await identityToolkit("sendOobCode", { requestType: "PASSWORD_RESET", email, ...(continueUrl ? { continueUrl } : {}) });
    if (!res.ok) console.error(`Email per la nuova password non inviata a ${email}: ${res.code}`);
  } catch (error) {
    console.error(`Email per la nuova password non inviata a ${email}`, error);
  }
}

/** Vero se l'email dell'utente è confermata. Senza Firebase non si controlla. */
export async function isEmailVerified(userId: string): Promise<boolean> {
  if (!firebaseEnabled()) return true;
  const [user] = await db.select({ firebaseUid: users.firebaseUid }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.firebaseUid) return false;
  try {
    return (await adminAuth().getUser(user.firebaseUid)).emailVerified;
  } catch (error) {
    console.error("Stato dell'email non leggibile da Firebase", error);
    return false;
  }
}

/**
 * Fa inviare da Firebase l'email per confermare l'indirizzo. Serve la password appena verificata (Firebase
 * chiede che a farlo sia l'utente stesso). Restituisce false se l'invio non è riuscito.
 */
export async function sendVerificationEmail(email: string, password: string): Promise<boolean> {
  if (!firebaseEnabled()) return true;
  const signIn = await identityToolkit<{ idToken: string }>("signInWithPassword", { email, password, returnSecureToken: true });
  if (!signIn.ok) return false;
  const continueUrl = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}/login` : undefined;
  const res = await identityToolkit("sendOobCode", { requestType: "VERIFY_EMAIL", idToken: signIn.data.idToken, ...(continueUrl ? { continueUrl } : {}) });
  if (!res.ok) console.error(`Email di conferma non inviata a ${email}: ${res.code}`);
  return res.ok;
}
