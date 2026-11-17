import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { berths, contracts, messageRecipients, messages, owners, ownerAccess, piers, users, type Role } from "@/db/schema";
import { audit } from "@/lib/audit";
import { CONTRACT_TYPE_LABEL } from "@/lib/labels";
import { DomainError } from "./errors";
import { pushToOwners } from "./push";

// Messaggi dal porto ai diportisti: destinatari, permessi per ruolo, invio, lettura.

export type MessageKind = "urgente" | "lavori" | "info";
export type ContractType = keyof typeof CONTRACT_TYPE_LABEL;

export type Audience =
  | { type: "tutti" }
  | { type: "pontile"; pierId: string }
  | { type: "tipo"; contractType: ContractType }
  | { type: "in_porto" }
  | { type: "cliente"; ownerId: string };

/** L'operatore di banchina scrive a un pontile, a chi è in porto o a un cliente; direzione e ufficio a tutti. */
export function canSendTo(role: Role, audience: Audience["type"]): boolean {
  if (role === "admin" || role === "ufficio") return true;
  return audience === "pontile" || audience === "in_porto" || audience === "cliente";
}

// user.id vuoto: invio automatico (allerta vento), senza una persona che scrive.
type Sender = { marinaId: string; role: Role; user: { id: string | null } };

/** Clienti destinatari e descrizione del gruppo. I gruppi riguardano i contratti attivi; il singolo cliente qualsiasi cliente. */
export async function resolveAudience(marinaId: string, audience: Audience): Promise<{ ownerIds: string[]; label: string }> {
  const activeOwners = async (extra?: ReturnType<typeof and>) => {
    const rows = await db
      .selectDistinct({ ownerId: contracts.ownerId })
      .from(contracts)
      .leftJoin(berths, eq(berths.id, contracts.berthId))
      .innerJoin(owners, eq(owners.id, contracts.ownerId))
      .where(and(eq(contracts.marinaId, marinaId), eq(contracts.status, "attivo"), isNull(owners.anonymizedAt), extra));
    return rows.map((r) => r.ownerId);
  };
  switch (audience.type) {
    case "tutti":
      return { ownerIds: await activeOwners(), label: "Tutti i clienti con contratto attivo" };
    case "pontile": {
      const [pier] = await db
        .select({ name: piers.name })
        .from(piers)
        .where(and(eq(piers.id, audience.pierId), eq(piers.marinaId, marinaId)))
        .limit(1);
      if (!pier) throw new DomainError("Pontile non trovato.", "pierId");
      return { ownerIds: await activeOwners(and(eq(berths.pierId, audience.pierId))), label: pier.name };
    }
    case "tipo":
      return {
        ownerIds: await activeOwners(and(eq(contracts.type, audience.contractType))),
        label: `Contratti ${CONTRACT_TYPE_LABEL[audience.contractType].toLowerCase()}`,
      };
    case "in_porto":
      return { ownerIds: await activeOwners(and(eq(contracts.presence, "in_porto"))), label: "Chi è in porto adesso" };
    case "cliente": {
      const [owner] = await db
        .select({ id: owners.id, name: owners.displayName })
        .from(owners)
        .where(and(eq(owners.id, audience.ownerId), eq(owners.marinaId, marinaId), isNull(owners.anonymizedAt)))
        .limit(1);
      if (!owner) throw new DomainError("Cliente non trovato.", "ownerId");
      return { ownerIds: [owner.id], label: owner.name };
    }
  }
}

/** Quanti dei clienti indicati hanno almeno una persona con l'app attiva. */
export async function ownersWithApp(marinaId: string, ownerIds: string[]): Promise<number> {
  if (ownerIds.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${ownerAccess.ownerId})::int` })
    .from(ownerAccess)
    .where(and(eq(ownerAccess.marinaId, marinaId), inArray(ownerAccess.ownerId, ownerIds), isNull(ownerAccess.revokedAt)));
  return row.n;
}

export async function sendMessage(
  sender: Sender,
  input: { kind: MessageKind; title: string; body: string; audience: Audience },
): Promise<{ messageId: string; recipients: number; withApp: number }> {
  if (!canSendTo(sender.role, input.audience.type)) throw new DomainError("Il tuo ruolo non può scrivere a questo gruppo.", "audience");
  const { ownerIds, label } = await resolveAudience(sender.marinaId, input.audience);
  if (ownerIds.length === 0) throw new DomainError("Nessun cliente in questo gruppo: il messaggio non è stato inviato.", "audience");

  const messageId = await db.transaction(async (tx) => {
    const [message] = await tx
      .insert(messages)
      .values({ marinaId: sender.marinaId, senderId: sender.user.id, kind: input.kind, title: input.title, body: input.body, audience: label })
      .returning({ id: messages.id });
    await tx.insert(messageRecipients).values(ownerIds.map((ownerId) => ({ marinaId: sender.marinaId, messageId: message.id, ownerId })));
    await audit(sender, "messaggio ai diportisti", "messaggio", message.id, `${label}: ${input.title}`, tx);
    return message.id;
  });

  await pushToOwners(sender.marinaId, ownerIds, {
    title: input.kind === "urgente" ? `⚠️ ${input.title}` : input.title,
    body: input.body.length > 180 ? `${input.body.slice(0, 177)}…` : input.body,
    url: `/diportista/messaggi/${messageId}`,
    tag: messageId,
    urgent: input.kind === "urgente",
  });
  return { messageId, recipients: ownerIds.length, withApp: await ownersWithApp(sender.marinaId, ownerIds) };
}

// ───────────────────────── Personale ─────────────────────────

export async function sentMessages(marinaId: string, limit = 100) {
  return db
    .select({
      id: messages.id,
      kind: messages.kind,
      title: messages.title,
      audience: messages.audience,
      createdAt: messages.createdAt,
      senderName: users.name,
      total: count(messageRecipients.id),
      read: sql<number>`count(${messageRecipients.readAt})::int`,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .leftJoin(messageRecipients, eq(messageRecipients.messageId, messages.id))
    .where(eq(messages.marinaId, marinaId))
    .groupBy(messages.id, users.name)
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}

export async function messageWithRecipients(marinaId: string, messageId: string) {
  const [message] = await db
    .select({ message: messages, senderName: users.name })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .where(and(eq(messages.id, messageId), eq(messages.marinaId, marinaId)))
    .limit(1);
  if (!message) return null;
  const reader = sql<string | null>`(select u.name from users u where u.id = ${messageRecipients.readBy})`;
  const hasApp = sql<boolean>`exists (select 1 from owner_access a where a.owner_id = ${messageRecipients.ownerId} and a.revoked_at is null)`;
  const recipients = await db
    .select({
      ownerId: owners.id,
      ownerName: owners.displayName,
      phone: owners.phone,
      readAt: messageRecipients.readAt,
      readerName: reader,
      hasApp,
    })
    .from(messageRecipients)
    .innerJoin(owners, eq(owners.id, messageRecipients.ownerId))
    .where(eq(messageRecipients.messageId, messageId))
    .orderBy(sql`${messageRecipients.readAt} is not null`, asc(owners.displayName));
  return { ...message, recipients };
}

// ───────────────────────── Diportista ─────────────────────────

type OwnerScope = { marinaId: string; ownerId: string };

export async function ownerMessages(scope: OwnerScope) {
  return db
    .select({
      id: messages.id,
      kind: messages.kind,
      title: messages.title,
      body: messages.body,
      createdAt: messages.createdAt,
      readAt: messageRecipients.readAt,
    })
    .from(messageRecipients)
    .innerJoin(messages, eq(messages.id, messageRecipients.messageId))
    .where(and(eq(messageRecipients.ownerId, scope.ownerId), eq(messageRecipients.marinaId, scope.marinaId)))
    .orderBy(desc(messages.createdAt));
}

export async function ownerMessage(scope: OwnerScope, messageId: string) {
  const [row] = await db
    .select({ message: messages, readAt: messageRecipients.readAt })
    .from(messageRecipients)
    .innerJoin(messages, eq(messages.id, messageRecipients.messageId))
    .where(and(eq(messageRecipients.messageId, messageId), eq(messageRecipients.ownerId, scope.ownerId), eq(messageRecipients.marinaId, scope.marinaId)))
    .limit(1);
  return row ?? null;
}

export async function unreadCount(scope: OwnerScope): Promise<{ total: number; urgent: number }> {
  const [row] = await db
    .select({ total: count(), urgent: sql<number>`count(*) filter (where ${messages.kind} = 'urgente')::int` })
    .from(messageRecipients)
    .innerJoin(messages, eq(messages.id, messageRecipients.messageId))
    .where(and(eq(messageRecipients.ownerId, scope.ownerId), eq(messageRecipients.marinaId, scope.marinaId), isNull(messageRecipients.readAt)));
  return { total: row.total, urgent: row.urgent };
}

/** Segna letto per il cliente (vale per tutte le sue persone). Ignora i messaggi non suoi. */
export async function markRead(scope: OwnerScope & { userId: string }, messageId: string): Promise<void> {
  await db
    .update(messageRecipients)
    .set({ readAt: new Date(), readBy: scope.userId })
    .where(
      and(
        eq(messageRecipients.messageId, messageId),
        eq(messageRecipients.ownerId, scope.ownerId),
        eq(messageRecipients.marinaId, scope.marinaId),
        isNull(messageRecipients.readAt),
      ),
    );
}
