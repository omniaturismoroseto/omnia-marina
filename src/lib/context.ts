import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { marinas, memberships, ownerAccess, owners, type Role } from "@/db/schema";
import { privacyPending } from "./app-privacy";
import { isAccountManagerEmail } from "./account-manager";
import { getSession } from "./auth/session";

export interface MembershipInfo {
  marinaId: string;
  marinaName: string;
  role: Role;
}

/** Un cliente di cui l'utente può aprire l'area diportista. */
export interface OwnerAreaInfo {
  accessId: string;
  marinaId: string;
  marinaName: string;
  ownerId: string;
  ownerName: string;
  /** Vero finché il diportista non ha accettato l'informativa dell'app nella versione attuale. */
  privacyPending: boolean;
}

export interface UserContext {
  sessionId: string;
  user: { id: string; name: string; email: string };
  /** Account manager di Omnia Marina (vedi lib/account-manager.ts): `memberships` sono allora tutti i porti, come direzione. */
  accountManager: boolean;
  memberships: MembershipInfo[];
  ownerAreas: OwnerAreaInfo[];
  // Porto scelto in questa sessione (null finché l'utente non ne sceglie uno).
  activeMarinaId: string | null;
  // Area diportista aperta in questa sessione (null nel gestionale).
  activeOwnerAccessId: string | null;
  /** Solo account manager: ruolo con cui prova il porto (null = Direzione). */
  previewRole: Role | null;
  /** Solo account manager: cliente di cui vede l'area diportista. */
  previewOwnerId: string | null;
}

export interface OwnerContext {
  sessionId: string;
  user: { id: string; name: string; email: string };
  accessId: string;
  marinaId: string;
  marinaName: string;
  ownerId: string;
  ownerName: string;
  /** Vero finché l'informativa dell'app non è accettata: le pagine rimandano a /diportista/benvenuto. */
  privacyPending: boolean;
  /** Vero se l'utente ha anche altre aree (altri clienti o il gestionale): mostra «Cambia». */
  canSwitch: boolean;
  /**
   * Vero quando è l'account manager a guardare l'area di un cliente: niente accesso del cliente (`accessId` vuoto) e
   * niente tracce (messaggi segnati come letti, notifiche).
   */
  preview: boolean;
}

export interface MarinaContext extends UserContext {
  marinaId: string;
  marinaName: string;
  role: Role;
}

export const OFFICE: Role[] = ["admin", "ufficio"];
export const EVERYONE: Role[] = ["admin", "ufficio", "banchina"];

export function homeFor(role: Role): string {
  return role === "banchina" ? "/banchina" : "/";
}

const loadContext = cache(async (): Promise<UserContext | null> => {
  const session = await getSession();
  if (!session) return null;
  const accountManager = isAccountManagerEmail(session.user.email);
  const rows = accountManager
    ? (await db.select({ marinaId: marinas.id, marinaName: marinas.name }).from(marinas).orderBy(marinas.name)).map((m) => ({ ...m, role: "admin" as const }))
    : await db
        .select({ marinaId: memberships.marinaId, marinaName: marinas.name, role: memberships.role })
        .from(memberships)
        .innerJoin(marinas, eq(marinas.id, memberships.marinaId))
        .where(eq(memberships.userId, session.user.id))
        .orderBy(marinas.name);
  const areas = await ownerAreasFor(session.user.id);
  return {
    sessionId: session.sessionId,
    user: session.user,
    accountManager,
    memberships: rows,
    ownerAreas: areas,
    activeMarinaId: session.marinaId,
    activeOwnerAccessId: session.ownerAccessId,
    previewRole: accountManager ? session.previewRole : null,
    previewOwnerId: accountManager ? session.previewOwnerId : null,
  };
});

/** Clienti di cui l'utente può aprire l'area diportista (accessi non revocati, dati non cancellati). */
export async function ownerAreasFor(userId: string): Promise<OwnerAreaInfo[]> {
  const rows = await db
    .select({
      accessId: ownerAccess.id,
      marinaId: ownerAccess.marinaId,
      marinaName: marinas.name,
      ownerId: ownerAccess.ownerId,
      ownerName: owners.displayName,
      acceptedVersion: ownerAccess.privacyVersion,
      policyVersion: marinas.privacyPolicyVersion,
    })
    .from(ownerAccess)
    .innerJoin(owners, eq(owners.id, ownerAccess.ownerId))
    .innerJoin(marinas, eq(marinas.id, ownerAccess.marinaId))
    .where(and(eq(ownerAccess.userId, userId), isNull(ownerAccess.revokedAt), isNull(owners.anonymizedAt)))
    .orderBy(marinas.name, owners.displayName);
  return rows.map(({ acceptedVersion, policyVersion, ...area }) => ({ ...area, privacyPending: privacyPending(acceptedVersion, policyVersion) }));
}

// Utente autenticato, anche senza un porto selezionato.
export async function requireUser(): Promise<UserContext> {
  const ctx = await loadContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/**
 * Utente autenticato dentro un porto, con uno dei ruoli ammessi.
 * È il punto unico da cui pagine e azioni ottengono `marinaId`: ogni lettura e scrittura
 * deve filtrare per questo valore, mai per un identificativo arrivato dal browser.
 */
export async function requireMarina(allowed: Role[] = EVERYONE): Promise<MarinaContext> {
  const ctx = await requireUser();
  // Una sessione dell'area diportista non apre mai il gestionale, anche se la persona lavora nel porto.
  if (ctx.activeOwnerAccessId || ctx.previewOwnerId) redirect("/diportista");
  const active =
    ctx.memberships.find((m) => m.marinaId === ctx.activeMarinaId) ??
    // L'account manager sceglie sempre il porto: i porti possono essere molti, e uno solo oggi non lo è per sempre.
    (ctx.memberships.length === 1 && !ctx.accountManager ? ctx.memberships[0] : undefined);
  if (!active) redirect("/porti");
  // L'account manager prova il porto con il ruolo che ha scelto entrando.
  const role = ctx.accountManager ? (ctx.previewRole ?? "admin") : active.role;
  if (!allowed.includes(role)) redirect(homeFor(role));
  return { ...ctx, marinaId: active.marinaId, marinaName: active.marinaName, role };
}

/**
 * Utente nell'area diportista di un cliente. È il punto unico da cui le pagine del diportista ottengono porto e
 * cliente: ogni lettura filtra per `ownerId` e `marinaId` di qui, mai per identificativi arrivati dal browser.
 */
/**
 * Diportista nella sua area. Finché non ha accettato l'informativa dell'app viene rimandato a /diportista/benvenuto;
 * solo quella pagina e la sua azione passano `allowPrivacyPending`.
 */
export async function requireOwner({ allowPrivacyPending = false }: { allowPrivacyPending?: boolean } = {}): Promise<OwnerContext> {
  const ctx = await requireUser();
  if (ctx.accountManager && ctx.previewOwnerId && ctx.activeMarinaId) {
    const [owner] = await db
      .select({ ownerId: owners.id, ownerName: owners.displayName, marinaName: marinas.name })
      .from(owners)
      .innerJoin(marinas, eq(marinas.id, owners.marinaId))
      .where(and(eq(owners.id, ctx.previewOwnerId), eq(owners.marinaId, ctx.activeMarinaId), isNull(owners.anonymizedAt)))
      .limit(1);
    if (!owner) redirect("/porti");
    // L'account manager in prova non accetta niente al posto del cliente: vede la pagina di benvenuto solo se la apre.
    return { sessionId: ctx.sessionId, user: ctx.user, accessId: "", marinaId: ctx.activeMarinaId, ...owner, privacyPending: false, canSwitch: true, preview: true };
  }
  const area = ctx.ownerAreas.find((a) => a.accessId === ctx.activeOwnerAccessId);
  // Nessuna area aperta, oppure l'accesso è stato revocato: si torna alla scelta.
  if (!area) redirect("/porti");
  if (area.privacyPending && !allowPrivacyPending) redirect("/diportista/benvenuto");
  const canSwitch = ctx.ownerAreas.length + ctx.memberships.length > 1;
  return { sessionId: ctx.sessionId, user: ctx.user, ...area, canSwitch, preview: false };
}

// Come requireMarina, ma senza reindirizzare: utile nelle pagine pubbliche (login).
export async function currentUser(): Promise<UserContext | null> {
  return loadContext();
}
