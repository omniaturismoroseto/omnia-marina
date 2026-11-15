import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { charges, ledgerEntries, ledgerImports, owners, payments, type PaymentMethod } from "@/db/schema";
import { formatDate, todayRome } from "@/lib/dates";
import { formatMoney, splitVat } from "@/lib/format";
import { CHARGE_TO_LEDGER_CATEGORY } from "@/lib/labels";
import type { LedgerDraft } from "@/lib/ledger-import";
import type { Actor } from "./contracts";
import { DomainError } from "./errors";

export type ChargeStatus = "pagato" | "parziale" | "scaduto" | "aperto" | "annullato";

export function chargeStatus(charge: { grossCents: number; dueDate: string; cancelledAt: Date | null }, paidCents: number, today: string): ChargeStatus {
  if (charge.cancelledAt) return "annullato";
  if (paidCents >= charge.grossCents) return "pagato";
  if (charge.dueDate < today) return "scaduto";
  return paidCents > 0 ? "parziale" : "aperto";
}

export interface ChargeInput {
  ownerId: string;
  contractId: string | null;
  kind: "ormeggio" | "servizi" | "utenze" | "altro";
  description: string;
  issueDate: string;
  dueDate: string;
  grossCents: number;
  vatRate: number;
  notes: string | null;
}

export async function createCharge(tx: Tx, actor: Actor, input: ChargeInput): Promise<string> {
  const [owner] = await tx.select({ id: owners.id }).from(owners).where(and(eq(owners.id, input.ownerId), eq(owners.marinaId, actor.marinaId))).limit(1);
  if (!owner) throw new DomainError("Cliente non trovato.", "ownerId");
  if (input.grossCents <= 0) throw new DomainError("L'importo deve essere maggiore di zero.", "amount");
  const { netCents, vatCents } = splitVat(input.grossCents, input.vatRate);
  const [row] = await tx
    .insert(charges)
    .values({ marinaId: actor.marinaId, ...input, netCents, vatCents, createdBy: actor.userId })
    .returning({ id: charges.id });
  return row.id;
}

export interface PaymentInput {
  chargeId: string;
  paidOn: string;
  amountCents: number;
  method: PaymentMethod;
  reference: string | null;
}

// Registra un incasso e la corrispondente entrata in prima nota (cassa per i contanti, banca per il resto).
export async function registerPayment(tx: Tx, actor: Actor, input: PaymentInput): Promise<string> {
  const [charge] = await tx
    .select()
    .from(charges)
    .where(and(eq(charges.id, input.chargeId), eq(charges.marinaId, actor.marinaId)))
    .for("update")
    .limit(1);
  if (!charge) throw new DomainError("Addebito non trovato.");
  if (charge.cancelledAt) throw new DomainError("L'addebito è annullato.");

  const [{ paid }] = await tx
    .select({ paid: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int` })
    .from(payments)
    .where(eq(payments.chargeId, charge.id));
  const residual = charge.grossCents - paid;
  if (input.amountCents <= 0) throw new DomainError("L'importo deve essere maggiore di zero.", "amount");
  if (input.amountCents > residual) {
    throw new DomainError(`L'importo supera il residuo da incassare (${formatMoney(residual)}).`, "amount");
  }

  const [payment] = await tx
    .insert(payments)
    .values({
      marinaId: actor.marinaId,
      chargeId: charge.id,
      ownerId: charge.ownerId,
      paidOn: input.paidOn,
      amountCents: input.amountCents,
      method: input.method,
      reference: input.reference,
      createdBy: actor.userId,
    })
    .returning({ id: payments.id });

  const [owner] = await tx.select({ displayName: owners.displayName }).from(owners).where(eq(owners.id, charge.ownerId)).limit(1);
  await tx.insert(ledgerEntries).values({
    marinaId: actor.marinaId,
    entryDate: input.paidOn,
    direction: "entrata",
    account: input.method === "contanti" ? "cassa" : "banca",
    amountCents: input.amountCents,
    category: CHARGE_TO_LEDGER_CATEGORY[charge.kind],
    description: charge.description,
    counterparty: owner?.displayName ?? null,
    documentRef: input.reference,
    paymentId: payment.id,
    createdBy: actor.userId,
  });
  return payment.id;
}

// Storna un incasso registrato per errore: sparisce anche la riga di prima nota collegata.
export async function deletePayment(tx: Tx, actor: Actor, paymentId: string): Promise<void> {
  const deleted = await tx
    .delete(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.marinaId, actor.marinaId)))
    .returning({ id: payments.id });
  if (deleted.length === 0) throw new DomainError("Incasso non trovato.");
}

export interface LedgerImportInput {
  fileName: string;
  fileHash: string;
  sheetName: string;
  rowsCount: number;
  entries: LedgerDraft[];
}

// Salva i movimenti di una prima nota importata da Excel, collegati all'importazione così da poterli
// annullare tutti insieme. Lo stesso file non si importa due volte.
export async function importLedger(tx: Tx, actor: Actor, input: LedgerImportInput): Promise<string> {
  if (input.entries.length === 0) throw new DomainError("Non ci sono movimenti da importare.");
  const [already] = await tx
    .select({ createdAt: ledgerImports.createdAt })
    .from(ledgerImports)
    .where(and(eq(ledgerImports.marinaId, actor.marinaId), eq(ledgerImports.fileHash, input.fileHash)))
    .limit(1);
  if (already) {
    const when = formatDate(todayRome(already.createdAt));
    throw new DomainError(`Questo file è già stato importato il ${when}. Per importarlo di nuovo annulla prima quell'importazione.`);
  }
  const dates = input.entries.map((e) => e.entryDate).sort();
  const [row] = await tx
    .insert(ledgerImports)
    .values({
      marinaId: actor.marinaId,
      fileName: input.fileName,
      fileHash: input.fileHash,
      sheetName: input.sheetName,
      rowsCount: input.rowsCount,
      entriesCount: input.entries.length,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      createdBy: actor.userId,
    })
    .returning({ id: ledgerImports.id });
  for (let i = 0; i < input.entries.length; i += 500) {
    await tx.insert(ledgerEntries).values(
      input.entries.slice(i, i + 500).map((e) => ({ ...e, marinaId: actor.marinaId, importId: row.id, createdBy: actor.userId })),
    );
  }
  return row.id;
}

// Annulla un'importazione: spariscono tutti i movimenti che aveva creato.
export async function undoLedgerImport(tx: Tx, actor: Actor, importId: string): Promise<{ fileName: string; entriesCount: number }> {
  const deleted = await tx
    .delete(ledgerImports)
    .where(and(eq(ledgerImports.id, importId), eq(ledgerImports.marinaId, actor.marinaId)))
    .returning({ fileName: ledgerImports.fileName, entriesCount: ledgerImports.entriesCount });
  if (deleted.length === 0) throw new DomainError("Importazione non trovata.");
  return deleted[0];
}
