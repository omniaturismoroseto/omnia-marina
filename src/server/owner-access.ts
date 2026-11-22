import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { ownerAccess, ownerInvites, owners, sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { INVITE_DAYS, INVITE_MAX_FAILED, canInvite, inviteCodeFromBytes, normalizeInviteCode, taxIdMatches } from "@/lib/owner-access";
import { createAccount, isEmailVerified, sendVerificationEmail, verifyLogin } from "./credentials";
import { DomainError } from "./errors";

// Regole dell'area diportista: inviti dalla scheda cliente, attivazione con codice + codice fiscale, revoca.
// Le azioni (permessi e validazione) stanno in owner-access-actions.ts.

type Actor = { marinaId: string; user: { id: string } };

function inviteExpiry(): Date {
  return new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
}

// Un codice nuovo, diverso da quelli in attesa (la probabilità di un doppione è minima, ma si controlla).
async function freshCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = inviteCodeFromBytes(randomBytes(16));
    const [taken] = await db.select({ id: ownerInvites.id }).from(ownerInvites).where(eq(ownerInvites.code, code)).limit(1);
    if (!taken) return code;
  }
  throw new Error("Impossibile generare un codice d'invito.");
}

async function ownerOf(marinaId: string, ownerId: string) {
  const [owner] = await db
    .select()
    .from(owners)
    .where(and(eq(owners.id, ownerId), eq(owners.marinaId, marinaId)))
    .limit(1);
  if (!owner || owner.anonymizedAt) throw new DomainError("Cliente non trovato.");
  return owner;
}

export async function createInvite(actor: Actor, ownerId: string, name: string): Promise<string> {
  const owner = await ownerOf(actor.marinaId, ownerId);
  if (!canInvite(owner)) {
    throw new DomainError("Per invitare serve il codice fiscale o la partita IVA nella scheda del cliente: è la prova che chiediamo a chi attiva l'accesso.");
  }
  const code = await freshCode();
  const [invite] = await db
    .insert(ownerInvites)
    .values({ marinaId: actor.marinaId, ownerId, name, code, expiresAt: inviteExpiry(), createdBy: actor.user.id })
    .returning({ id: ownerInvites.id });
  await audit(actor, "invito area diportista", "cliente", ownerId, name);
  return invite.id;
}

async function inviteOf(marinaId: string, inviteId: string) {
  const [invite] = await db
    .select()
    .from(ownerInvites)
    .where(and(eq(ownerInvites.id, inviteId), eq(ownerInvites.marinaId, marinaId)))
    .limit(1);
  if (!invite) throw new DomainError("Invito non trovato.");
  return invite;
}

/** Nuovo codice e nuova scadenza: il codice vecchio smette di valere. */
export async function renewInvite(actor: Actor, inviteId: string): Promise<void> {
  const invite = await inviteOf(actor.marinaId, inviteId);
  await db
    .update(ownerInvites)
    .set({ code: await freshCode(), expiresAt: inviteExpiry(), failedAttempts: 0 })
    .where(eq(ownerInvites.id, invite.id));
  await audit(actor, "nuovo codice area diportista", "cliente", invite.ownerId, invite.name);
}

export async function cancelInvite(actor: Actor, inviteId: string): Promise<void> {
  const invite = await inviteOf(actor.marinaId, inviteId);
  await db.delete(ownerInvites).where(eq(ownerInvites.id, invite.id));
  await audit(actor, "invito annullato", "cliente", invite.ownerId, invite.name);
}

/** Toglie l'accesso e chiude subito le sessioni aperte nell'area di quel cliente. */
export async function revokeAccess(actor: Actor, accessId: string): Promise<void> {
  const [access] = await db
    .select({ id: ownerAccess.id, ownerId: ownerAccess.ownerId, email: users.email })
    .from(ownerAccess)
    .innerJoin(users, eq(users.id, ownerAccess.userId))
    .where(and(eq(ownerAccess.id, accessId), eq(ownerAccess.marinaId, actor.marinaId), isNull(ownerAccess.revokedAt)))
    .limit(1);
  if (!access) throw new DomainError("Accesso non trovato.");
  await db.transaction(async (tx) => {
    await tx.update(ownerAccess).set({ revokedAt: new Date() }).where(eq(ownerAccess.id, access.id));
    await tx.delete(sessions).where(eq(sessions.ownerAccessId, access.id));
    await audit(actor, "accesso area diportista revocato", "cliente", access.ownerId, access.email, tx);
  });
}

// ───────────────────────── Attivazione ─────────────────────────

export type ActivationResult =
  | { ok: true; userId: string; accessId: string; marinaId: string; emailVerified: boolean; verificationSent: boolean }
  | { ok: false; field?: "code" | "taxId" | "password"; message: string };

const WRONG = "Il codice di attivazione o il codice fiscale / partita IVA non sono corretti.";

/**
 * Attiva un invito: controlla codice e seconda prova, crea l'account (o usa quello che l'email ha già, con la sua
 * password) e lo collega al cliente. L'invito si consuma; l'area si apre dopo la conferma dell'email.
 */
export async function activateInvite(input: { code: string; taxId: string; email: string; password: string }): Promise<ActivationResult> {
  const code = normalizeInviteCode(input.code);
  if (!code) return { ok: false, field: "code", message: WRONG };

  const [row] = await db
    .select({ invite: ownerInvites, owner: owners })
    .from(ownerInvites)
    .innerJoin(owners, eq(owners.id, ownerInvites.ownerId))
    .where(and(eq(ownerInvites.code, code), gt(ownerInvites.expiresAt, new Date())))
    .limit(1);
  if (!row || row.owner.anonymizedAt) return { ok: false, field: "code", message: WRONG };
  const { invite, owner } = row;

  if (invite.failedAttempts >= INVITE_MAX_FAILED) {
    return { ok: false, field: "code", message: "Questo codice è bloccato dopo troppi tentativi: chiedi al porto un codice nuovo." };
  }
  // Ogni prova sbagliata (codice fiscale, o password di un account esistente) consuma un tentativo dell'invito:
  // così l'attivazione non diventa un modo per provare password altrui senza il freno della pagina di accesso.
  const countFailure = () =>
    db
      .update(ownerInvites)
      .set({ failedAttempts: sql`${ownerInvites.failedAttempts} + 1` })
      .where(eq(ownerInvites.id, invite.id));
  if (!taxIdMatches(input.taxId, owner)) {
    await countFailure();
    return { ok: false, field: "taxId", message: WRONG };
  }

  // Account: quello che l'email ha già (serve la sua password) oppure uno nuovo.
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  let userId: string;
  if (existing) {
    const login = await verifyLogin(input.email, input.password);
    if (!login.ok) {
      if (login.reason === "credentials") await countFailure();
      return {
        ok: false,
        field: "password",
        message:
          login.reason === "credentials"
            ? "Questa email ha già un account Omnia Marina: inserisci la sua password (se non la ricordi, usa «Password dimenticata?» nella pagina di accesso)."
            : "Il servizio di accesso non risponde. Riprova tra qualche minuto.",
      };
    }
    userId = login.userId;
  } else {
    userId = await createAccount(db, { email: input.email, name: invite.name, password: input.password });
  }

  // L'invito si consuma una volta sola: se due richieste arrivano insieme, vince la prima.
  const accessId = await db.transaction(async (tx) => {
    const consumed = await tx.delete(ownerInvites).where(eq(ownerInvites.id, invite.id)).returning({ id: ownerInvites.id });
    if (consumed.length === 0) return null;
    const [access] = await tx
      .insert(ownerAccess)
      .values({ marinaId: invite.marinaId, ownerId: owner.id, userId, createdBy: invite.createdBy })
      // Chi era stato revocato e riceve un nuovo invito torna ad avere accesso.
      .onConflictDoUpdate({ target: [ownerAccess.ownerId, ownerAccess.userId], set: { revokedAt: null } })
      .returning({ id: ownerAccess.id });
    await audit({ marinaId: invite.marinaId, user: { id: userId } }, "accesso area diportista attivato", "cliente", owner.id, input.email, tx);
    return access.id;
  });
  if (!accessId) return { ok: false, field: "code", message: WRONG };

  const emailVerified = await isEmailVerified(userId);
  const verificationSent = emailVerified ? false : await sendVerificationEmail(input.email, input.password);
  return { ok: true, userId, accessId, marinaId: invite.marinaId, emailVerified, verificationSent };
}

/** Segna l'ultimo ingresso nell'area diportista (accesso o scelta dell'area). */
export async function touchAccess(accessId: string): Promise<void> {
  await db.update(ownerAccess).set({ lastSeenAt: new Date() }).where(eq(ownerAccess.id, accessId));
}
