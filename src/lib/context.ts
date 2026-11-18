import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { marinas, memberships, ownerAccess, owners, type Role } from "@/db/schema";
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
}

export interface UserContext {
  sessionId: string;
  user: { id: string; name: string; email: string };
  memberships: MembershipInfo[];
  ownerAreas: OwnerAreaInfo[];
  // Porto scelto in questa sessione (null finché l'utente non ne sceglie uno).
  activeMarinaId: string | null;
  // Area diportista aperta in questa sessione (null nel gestionale).
  activeOwnerAccessId: string | null;
}

export interface OwnerContext {
  sessionId: string;
  user: { id: string; name: string; email: string };
  accessId: string;
  marinaId: string;
  marinaName: string;
  ownerId: string;
  ownerName: string;
  /** Vero se l'utente ha anche altre aree (altri clienti o il gestionale): mostra «Cambia». */
  canSwitch: boolean;
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
  const rows = await db
    .select({ marinaId: memberships.marinaId, marinaName: marinas.name, role: memberships.role })
    .from(memberships)
    .innerJoin(marinas, eq(marinas.id, memberships.marinaId))
    .where(eq(memberships.userId, session.user.id))
    .orderBy(marinas.name);
  const areas = await ownerAreasFor(session.user.id);
  return {
    sessionId: session.sessionId,
    user: session.user,
    memberships: rows,
    ownerAreas: areas,
    activeMarinaId: session.marinaId,
    activeOwnerAccessId: session.ownerAccessId,
  };
});

/** Clienti di cui l'utente può aprire l'area diportista (accessi non revocati, dati non cancellati). */
export async function ownerAreasFor(userId: string): Promise<OwnerAreaInfo[]> {
  return db
    .select({
      accessId: ownerAccess.id,
      marinaId: ownerAccess.marinaId,
      marinaName: marinas.name,
      ownerId: ownerAccess.ownerId,
      ownerName: owners.displayName,
    })
    .from(ownerAccess)
    .innerJoin(owners, eq(owners.id, ownerAccess.ownerId))
    .innerJoin(marinas, eq(marinas.id, ownerAccess.marinaId))
    .where(and(eq(ownerAccess.userId, userId), isNull(ownerAccess.revokedAt), isNull(owners.anonymizedAt)))
    .orderBy(marinas.name, owners.displayName);
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
  if (ctx.activeOwnerAccessId) redirect("/diportista");
  const active =
    ctx.memberships.find((m) => m.marinaId === ctx.activeMarinaId) ??
    (ctx.memberships.length === 1 ? ctx.memberships[0] : undefined);
  if (!active) redirect("/porti");
  if (!allowed.includes(active.role)) redirect(homeFor(active.role));
  return { ...ctx, marinaId: active.marinaId, marinaName: active.marinaName, role: active.role };
}

/**
 * Utente nell'area diportista di un cliente. È il punto unico da cui le pagine del diportista ottengono porto e
 * cliente: ogni lettura filtra per `ownerId` e `marinaId` di qui, mai per identificativi arrivati dal browser.
 */
export async function requireOwner(): Promise<OwnerContext> {
  const ctx = await requireUser();
  const area = ctx.ownerAreas.find((a) => a.accessId === ctx.activeOwnerAccessId);
  // Nessuna area aperta, oppure l'accesso è stato revocato: si torna alla scelta.
  if (!area) redirect("/porti");
  const canSwitch = ctx.ownerAreas.length + ctx.memberships.length > 1;
  return { sessionId: ctx.sessionId, user: ctx.user, ...area, canSwitch };
}

// Come requireMarina, ma senza reindirizzare: utile nelle pagine pubbliche (login).
export async function currentUser(): Promise<UserContext | null> {
  return loadContext();
}
