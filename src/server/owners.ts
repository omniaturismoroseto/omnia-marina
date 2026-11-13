import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { privacyConsents } from "@/db/schema";

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
