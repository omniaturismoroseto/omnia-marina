import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { marinas, memberships, type Role } from "@/db/schema";
import { getSession } from "./auth/session";

export interface MembershipInfo {
  marinaId: string;
  marinaName: string;
  role: Role;
}

export interface UserContext {
  sessionId: string;
  user: { id: string; name: string; email: string };
  memberships: MembershipInfo[];
  // Porto scelto in questa sessione (null finché l'utente non ne sceglie uno).
  activeMarinaId: string | null;
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
  return { sessionId: session.sessionId, user: session.user, memberships: rows, activeMarinaId: session.marinaId };
});

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
  const active =
    ctx.memberships.find((m) => m.marinaId === ctx.activeMarinaId) ??
    (ctx.memberships.length === 1 ? ctx.memberships[0] : undefined);
  if (!active) redirect("/porti");
  if (!allowed.includes(active.role)) redirect(homeFor(active.role));
  return { ...ctx, marinaId: active.marinaId, marinaName: active.marinaName, role: active.role };
}

// Come requireMarina, ma senza reindirizzare: utile nelle pagine pubbliche (login).
export async function currentUser(): Promise<UserContext | null> {
  return loadContext();
}
