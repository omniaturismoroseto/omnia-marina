import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type Role } from "@/db/schema";

const COOKIE = "omnia_marina_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Apre una sessione. Con `ownerAccessId` la sessione è nell'area diportista di quel cliente (e `marinaId` è il suo porto). */
export async function createSession(userId: string, marinaId: string | null, ownerAccessId: string | null = null): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + MAX_AGE_SECONDS * 1000);
  await db.insert(sessions).values({ id: hashToken(token), userId, marinaId, ownerAccessId, expiresAt });
  // Pulizia opportunistica delle sessioni scadute dello stesso utente.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));

  // EMBEDDED_PREVIEW=true serve solo per le anteprime mostrate dentro un riquadro di un altro sito
  // (iframe): lì il browser accetta il cookie soltanto se è SameSite=None. Mai in produzione.
  const embedded = process.env.EMBEDDED_PREVIEW === "true";
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: embedded ? "none" : "lax",
    secure: embedded || process.env.NODE_ENV === "production",
    partitioned: embedded,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  store.delete(COOKIE);
}

export interface SessionInfo {
  sessionId: string;
  marinaId: string | null;
  // Area diportista: l'accesso del cliente su cui si sta lavorando. Null nel gestionale.
  ownerAccessId: string | null;
  // Prove dell'account manager (vedi sessions.previewRole/previewOwnerId): contano solo per lui.
  previewRole: Role | null;
  previewOwnerId: string | null;
  user: { id: string; name: string; email: string };
}

// Una sola lettura per richiesta, anche se più componenti la chiedono.
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  // La validità della sessione dipende dall'ora e dal database: va sempre verificata al momento
  // della richiesta, mai riusata da un prerender. Da qui in poi la pagina è "dinamica".
  await connection();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      marinaId: sessions.marinaId,
      ownerAccessId: sessions.ownerAccessId,
      previewRole: sessions.previewRole,
      previewOwnerId: sessions.previewOwnerId,
      userId: users.id,
      name: users.name,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return {
    sessionId: row.sessionId,
    marinaId: row.marinaId,
    ownerAccessId: row.ownerAccessId,
    previewRole: row.previewRole,
    previewOwnerId: row.previewOwnerId,
    user: { id: row.userId, name: row.name, email: row.email },
  };
});

/**
 * Porta la sessione nel gestionale di un porto (esce dall'area diportista, se c'era). `previewRole`: solo per l'account
 * manager, il ruolo con cui prova il porto (vuoto = Direzione).
 */
export async function setSessionMarina(sessionId: string, marinaId: string, previewRole: Role | null = null): Promise<void> {
  await db.update(sessions).set({ marinaId, ownerAccessId: null, previewRole, previewOwnerId: null }).where(eq(sessions.id, sessionId));
}

/** Porta la sessione nell'area diportista di un cliente. */
export async function setSessionOwnerArea(sessionId: string, marinaId: string, ownerAccessId: string): Promise<void> {
  await db.update(sessions).set({ marinaId, ownerAccessId, previewRole: null, previewOwnerId: null }).where(eq(sessions.id, sessionId));
}

/** Solo per l'account manager: vede l'area diportista di un cliente del porto, senza un accesso del cliente. */
export async function setSessionOwnerPreview(sessionId: string, marinaId: string, ownerId: string): Promise<void> {
  await db.update(sessions).set({ marinaId, ownerAccessId: null, previewRole: null, previewOwnerId: ownerId }).where(eq(sessions.id, sessionId));
}

// Chiude le sessioni di un utente dopo un cambio di password, tranne quella indicata (di chi sta operando).
export async function destroyUserSessions(userId: string, exceptSessionId: string): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)));
}
