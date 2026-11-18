import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { contracts, owners, privacyConsents } from "@/db/schema";
import { DomainError } from "./errors";
import { archiveOwnerBoats } from "./boats";

export type ConsentKind = "informativa" | "marketing" | "terzi";
export type ConsentState = Record<ConsentKind, { granted: boolean; recordedAt: Date; policyVersion: string } | null>;

// Stato attuale dei consensi: per ogni tipo vale l'ultima riga registrata.
export async function latestConsents(marinaId: string, ownerId?: string): Promise<Map<string, ConsentState>> {
  const rows = await db
    .selectDistinctOn([privacyConsents.ownerId, privacyConsents.kind], {
      ownerId: privacyConsents.ownerId,
      kind: privacyConsents.kind,
      granted: privacyConsents.granted,
      recordedAt: privacyConsents.recordedAt,
      policyVersion: privacyConsents.policyVersion,
    })
    .from(privacyConsents)
    .where(and(eq(privacyConsents.marinaId, marinaId), ownerId ? eq(privacyConsents.ownerId, ownerId) : undefined))
    .orderBy(privacyConsents.ownerId, privacyConsents.kind, desc(privacyConsents.recordedAt));

  const map = new Map<string, ConsentState>();
  for (const row of rows) {
    const state = map.get(row.ownerId) ?? { informativa: null, marketing: null, terzi: null };
    state[row.kind] = { granted: row.granted, recordedAt: row.recordedAt, policyVersion: row.policyVersion };
    map.set(row.ownerId, state);
  }
  return map;
}

export function hasInformativa(state: ConsentState | undefined): boolean {
  return state?.informativa?.granted === true;
}

// Categoria «Ex cliente» (il nome lo sceglie la direzione): si spunta solo su chi non ha contratti attivi.
// La spunta si toglie da sola quando il cliente ha di nuovo un contratto attivo (src/server/contracts.ts). Spuntarla
// archivia anche le sue barche (src/server/boats.ts).
export async function setOwnerFormer(tx: Tx, marinaId: string, ownerId: string, former: boolean) {
  const [owner] = await tx
    .select({ id: owners.id })
    .from(owners)
    .where(and(eq(owners.id, ownerId), eq(owners.marinaId, marinaId)))
    .limit(1);
  if (!owner) throw new DomainError("Cliente non trovato.");
  if (former) {
    const [active] = await tx
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.ownerId, ownerId), eq(contracts.marinaId, marinaId), eq(contracts.status, "attivo")))
      .limit(1);
    if (active) throw new DomainError("Il cliente ha un contratto attivo: la categoria si può usare solo per chi non ne ha.");
  }
  await tx.update(owners).set({ former, updatedAt: new Date() }).where(eq(owners.id, ownerId));
  // Chi va via si porta in archivio le barche (che non hanno contratti attivi, come lui).
  if (former) await archiveOwnerBoats(tx, marinaId, ownerId);
}
