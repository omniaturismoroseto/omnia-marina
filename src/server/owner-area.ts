import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { berths, boats, contracts, piers } from "@/db/schema";
import { addDays, diffDays } from "@/lib/dates";
import { listCharges, type ChargeRow } from "./charges";

// Dati dell'area diportista. Ogni funzione riceve porto e cliente da requireOwner() e filtra per entrambi.

type OwnerScope = { marinaId: string; ownerId: string };

/** Contratti che il diportista può vedere: attivi e conclusi (mai bozze né annullati), i più recenti prima. */
export async function ownerContracts(scope: OwnerScope) {
  return db
    .select({
      id: contracts.id,
      number: contracts.number,
      type: contracts.type,
      status: contracts.status,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      boatName: boats.name,
      berthCode: berths.code,
      pierName: piers.name,
    })
    .from(contracts)
    .innerJoin(boats, eq(boats.id, contracts.boatId))
    .leftJoin(berths, eq(berths.id, contracts.berthId))
    .leftJoin(piers, eq(piers.id, berths.pierId))
    .where(and(eq(contracts.marinaId, scope.marinaId), eq(contracts.ownerId, scope.ownerId), inArray(contracts.status, ["attivo", "concluso"])))
    .orderBy(desc(contracts.startDate));
}

export async function ownerBoats(scope: OwnerScope) {
  return db
    .select({
      id: boats.id,
      name: boats.name,
      type: boats.type,
      hasPhoto: boats.hasPhoto,
      photoVersion: boats.photoVersion,
      lengthCm: boats.lengthCm,
      beamCm: boats.beamCm,
      insuranceCompany: boats.insuranceCompany,
      insuranceExpiry: boats.insuranceExpiry,
    })
    .from(boats)
    .where(and(eq(boats.marinaId, scope.marinaId), eq(boats.ownerId, scope.ownerId)))
    .orderBy(asc(boats.name));
}

/** Addebiti del cliente, esclusi gli annullati: per l'estratto conto e le scadenze. */
export async function ownerCharges(scope: OwnerScope, today: string): Promise<ChargeRow[]> {
  const rows = await listCharges(scope.marinaId, today, { ownerId: scope.ownerId, newestFirst: true });
  return rows.filter((r) => r.status !== "annullato");
}

export type Deadline = {
  key: string;
  date: string;
  title: string;
  detail?: string;
  // Importo ancora da pagare (solo per le rate).
  amountCents?: number;
  tone: "bad" | "warn" | "neutral";
};

/**
 * Scadenze da mostrare: rate non pagate, fine dei contratti attivi nei prossimi 60 giorni, assicurazioni scadute o
 * in scadenza nei prossimi 30. In ordine di data.
 */
export function ownerDeadlines(
  input: {
    charges: ChargeRow[];
    contracts: { id: string; number: string | null; status: string; endDate: string; berthCode: string | null }[];
    boats: { id: string; name: string; insuranceExpiry: string | null }[];
  },
  today: string,
): Deadline[] {
  const list: Deadline[] = [];
  for (const ch of input.charges) {
    if (ch.status === "pagato" || ch.status === "annullato") continue;
    list.push({
      key: `c-${ch.id}`,
      date: ch.dueDate,
      title: ch.description,
      amountCents: ch.grossCents - ch.paidCents,
      tone: ch.dueDate < today ? "bad" : diffDays(today, ch.dueDate) <= 15 ? "warn" : "neutral",
    });
  }
  for (const c of input.contracts) {
    if (c.status !== "attivo" || c.endDate > addDays(today, 60)) continue;
    list.push({
      key: `k-${c.id}`,
      date: c.endDate,
      title: `Fine del contratto${c.berthCode ? ` (posto ${c.berthCode})` : ""}`,
      detail: "Per rinnovare, contatta l'ufficio almeno un mese prima.",
      tone: diffDays(today, c.endDate) <= 30 ? "warn" : "neutral",
    });
  }
  for (const b of input.boats) {
    if (!b.insuranceExpiry || b.insuranceExpiry > addDays(today, 30)) continue;
    list.push({
      key: `a-${b.id}`,
      date: b.insuranceExpiry,
      title: `Assicurazione di ${b.name}`,
      detail: b.insuranceExpiry < today ? "Scaduta: porta in ufficio la nuova polizza." : "In scadenza: porta in ufficio la nuova polizza.",
      tone: b.insuranceExpiry < today ? "bad" : "warn",
    });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}
