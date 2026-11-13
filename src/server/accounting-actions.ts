"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { charges, contracts, ledgerEntries, payments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatMoney } from "@/lib/format";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { LEDGER_CATEGORIES } from "@/lib/labels";
import { createCharge, deletePayment, registerPayment } from "./accounting";
import { toFormState } from "./errors";

const chargeSchema = z.object({
  ownerId: f.id("Scegli il cliente"),
  contractId: f.optId(),
  kind: f.choice(["ormeggio", "servizi", "utenze", "altro"]),
  description: f.text("Descrivi l'addebito"),
  issueDate: f.date(),
  dueDate: f.date("Indica la scadenza"),
  amount: f.money(),
  vatRate: f.int(0, 30, "Aliquota non valida"),
  notes: f.optText(),
});

export async function saveCharge(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(chargeSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { amount, ...d } = parsed.data;
  if (d.dueDate < d.issueDate) return fail("Controlla i campi evidenziati.", { dueDate: "La scadenza precede la data dell'addebito." });

  // Un eventuale contratto collegato deve essere dello stesso porto e dello stesso cliente.
  if (d.contractId) {
    const [c] = await db
      .select({ ownerId: contracts.ownerId })
      .from(contracts)
      .where(and(eq(contracts.id, d.contractId), eq(contracts.marinaId, ctx.marinaId)))
      .limit(1);
    if (!c || c.ownerId !== d.ownerId) return fail("Controlla i campi evidenziati.", { contractId: "Il contratto non appartiene a questo cliente." });
  }

  let chargeId: string;
  try {
    chargeId = await db.transaction(async (tx) => {
      const id = await createCharge(tx, { marinaId: ctx.marinaId, userId: ctx.user.id }, { ...d, grossCents: amount });
      await audit(ctx, "creazione", "addebito", id, `${d.description} · ${formatMoney(amount)}`, tx);
      return id;
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  redirect(`/contabilita/addebiti/${chargeId}`);
}

export async function cancelCharge(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const chargeId = String(formData.get("chargeId") ?? "");
  const result = await db.transaction(async (tx) => {
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(payments)
      .where(and(eq(payments.chargeId, chargeId), eq(payments.marinaId, ctx.marinaId)));
    if (count > 0) return "paid" as const;
    const updated = await tx
      .update(charges)
      .set({ cancelledAt: new Date() })
      .where(and(eq(charges.id, chargeId), eq(charges.marinaId, ctx.marinaId), isNull(charges.cancelledAt)))
      .returning({ id: charges.id });
    if (updated.length === 0) return "missing" as const;
    await audit(ctx, "annullamento", "addebito", chargeId, undefined, tx);
    return "ok" as const;
  });
  if (result === "paid") return fail("L'addebito ha incassi registrati: storna prima gli incassi.");
  if (result === "missing") return fail("Addebito non trovato o già annullato.");
  revalidatePath("/", "layout");
  return { ok: true };
}

const paymentSchema = z.object({
  chargeId: f.id(),
  paidOn: f.date("Indica la data dell'incasso"),
  amount: f.money(),
  method: f.choice(["contanti", "bonifico", "pos", "assegno", "altro"]),
  reference: f.optText(),
});

export async function addPayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(paymentSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { amount, ...d } = parsed.data;
  try {
    await db.transaction(async (tx) => {
      const id = await registerPayment(tx, { marinaId: ctx.marinaId, userId: ctx.user.id }, { ...d, amountCents: amount });
      await audit(ctx, "incasso", "addebito", d.chargeId, `${formatMoney(amount)} · ${d.method} · incasso ${id.slice(0, 8)}`, tx);
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Incasso registrato." };
}

export async function removePayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const paymentId = String(formData.get("paymentId") ?? "");
  try {
    await db.transaction(async (tx) => {
      await deletePayment(tx, { marinaId: ctx.marinaId, userId: ctx.user.id }, paymentId);
      await audit(ctx, "storno incasso", "incasso", paymentId, undefined, tx);
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

const ledgerSchema = z
  .object({
    entryDate: f.date(),
    direction: f.choice(["entrata", "uscita"]),
    account: f.choice(["cassa", "banca"]),
    amount: f.money(),
    category: f.text("Scegli la categoria"),
    description: f.text("Descrivi il movimento"),
    counterparty: f.optText(),
    documentRef: f.optText(),
  })
  .superRefine((d, ctx) => {
    if (d.amount <= 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "L'importo deve essere maggiore di zero" });
    if (!(LEDGER_CATEGORIES[d.direction] as readonly string[]).includes(d.category)) {
      ctx.addIssue({ code: "custom", path: ["category"], message: "Categoria non valida per questo tipo di movimento" });
    }
  });

// Movimento manuale di prima nota (spese, altre entrate). Gli incassi dei clienti si registrano dall'addebito.
export async function saveLedgerEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(ledgerSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { amount, ...d } = parsed.data;
  const [row] = await db
    .insert(ledgerEntries)
    .values({ marinaId: ctx.marinaId, ...d, amountCents: amount, createdBy: ctx.user.id })
    .returning({ id: ledgerEntries.id });
  await audit(ctx, "creazione", "prima nota", row.id, `${d.direction} ${formatMoney(amount)} · ${d.description}`);
  revalidatePath("/", "layout");
  return { ok: true, message: "Movimento registrato." };
}

export async function deleteLedgerEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const entryId = String(formData.get("entryId") ?? "");
  const deleted = await db
    .delete(ledgerEntries)
    .where(and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.marinaId, ctx.marinaId), isNull(ledgerEntries.paymentId)))
    .returning({ description: ledgerEntries.description, amountCents: ledgerEntries.amountCents });
  if (deleted.length === 0) return fail("Movimento non trovato, oppure collegato a un incasso: in quel caso storna l'incasso dall'addebito.");
  await audit(ctx, "eliminazione", "prima nota", entryId, `${deleted[0].description} · ${formatMoney(deleted[0].amountCents)}`);
  revalidatePath("/", "layout");
  return { ok: true };
}
