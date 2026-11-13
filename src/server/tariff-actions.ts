"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { berthCategories, priceLists, rates, seasonPeriods } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { addMonths, isValidISODate } from "@/lib/dates";
import { parseMoney } from "@/lib/format";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { quoteStay, type Quote } from "@/lib/pricing";

const ADMIN = ["admin" as const];
const RATE_FIELDS = ["dailyLow", "dailyMid", "dailyHigh", "monthlyLow", "monthlyMid", "monthlyHigh", "annual"] as const;

async function ownList(marinaId: string, listId: string) {
  const [list] = await db
    .select()
    .from(priceLists)
    .where(and(eq(priceLists.id, listId), eq(priceLists.marinaId, marinaId)))
    .limit(1);
  return list ?? null;
}

const listSchema = z.object({
  id: f.optId(),
  name: f.text("Dai un nome al listino"),
  validFrom: f.date(),
  validTo: f.date(),
  vatRate: f.int(0, 30, "Aliquota non valida"),
});

export async function savePriceList(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(listSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { id, ...data } = parsed.data;
  if (data.validTo < data.validFrom) return fail("Controlla i campi evidenziati.", { validTo: "La fine precede l'inizio." });

  if (id) {
    const updated = await db
      .update(priceLists)
      .set(data)
      .where(and(eq(priceLists.id, id), eq(priceLists.marinaId, ctx.marinaId)))
      .returning({ id: priceLists.id });
    if (updated.length === 0) return fail("Listino non trovato.");
    await audit(ctx, "modifica", "listino", id, data.name);
    revalidatePath("/", "layout");
    return { ok: true, message: "Salvato." };
  }

  const [created] = await db
    .insert(priceLists)
    .values({ marinaId: ctx.marinaId, ...data })
    .returning({ id: priceLists.id });
  await audit(ctx, "creazione", "listino", created.id, data.name);
  revalidatePath("/", "layout");
  redirect(`/tariffe?listino=${created.id}`);
}

// Copia un listino sull'anno successivo: stesse tariffe, periodi di stagione spostati di dodici mesi.
export async function duplicatePriceList(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const source = await ownList(ctx.marinaId, String(formData.get("listId") ?? ""));
  if (!source) return fail("Listino non trovato.");

  const newId = await db.transaction(async (tx) => {
    const year = Number(source.validFrom.slice(0, 4)) + 1;
    const [created] = await tx
      .insert(priceLists)
      .values({
        marinaId: ctx.marinaId,
        name: /\d{4}/.test(source.name) ? source.name.replace(/\d{4}/, String(year)) : `${source.name} (copia)`,
        validFrom: addMonths(source.validFrom, 12),
        validTo: addMonths(source.validTo, 12),
        vatRate: source.vatRate,
      })
      .returning({ id: priceLists.id });
    const periods = await tx.select().from(seasonPeriods).where(eq(seasonPeriods.priceListId, source.id));
    if (periods.length > 0) {
      await tx.insert(seasonPeriods).values(
        periods.map((p) => ({ marinaId: ctx.marinaId, priceListId: created.id, season: p.season, startDate: addMonths(p.startDate, 12), endDate: addMonths(p.endDate, 12) })),
      );
    }
    const rateRows = await tx.select().from(rates).where(eq(rates.priceListId, source.id));
    if (rateRows.length > 0) {
      await tx.insert(rates).values(rateRows.map(({ id: _id, priceListId: _list, ...r }) => ({ ...r, priceListId: created.id })));
    }
    await audit(ctx, "creazione", "listino", created.id, `Copia di ${source.name}`, tx);
    return created.id;
  });

  revalidatePath("/", "layout");
  redirect(`/tariffe?listino=${newId}`);
}

export async function deletePriceList(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const listId = String(formData.get("listId") ?? "");
  const deleted = await db
    .delete(priceLists)
    .where(and(eq(priceLists.id, listId), eq(priceLists.marinaId, ctx.marinaId)))
    .returning({ name: priceLists.name });
  if (deleted.length === 0) return fail("Listino non trovato.");
  await audit(ctx, "eliminazione", "listino", listId, deleted[0].name);
  revalidatePath("/", "layout");
  redirect("/tariffe");
}

// Salva l'intera griglia delle tariffe: un campo per ogni categoria e colonna, chiamato "categoria:colonna".
export async function saveRates(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const list = await ownList(ctx.marinaId, String(formData.get("listId") ?? ""));
  if (!list) return fail("Listino non trovato.");
  const categories = await db.select({ id: berthCategories.id }).from(berthCategories).where(eq(berthCategories.marinaId, ctx.marinaId));

  const errors: Record<string, string> = {};
  const rows = categories.map((cat) => {
    const values = {} as Record<(typeof RATE_FIELDS)[number], number>;
    for (const field of RATE_FIELDS) {
      const key = `${cat.id}:${field}`;
      const raw = String(formData.get(key) ?? "").trim();
      const cents = raw === "" ? 0 : parseMoney(raw);
      if (cents === null || cents < 0) errors[key] = "Importo non valido";
      values[field] = cents ?? 0;
    }
    return { marinaId: ctx.marinaId, priceListId: list.id, categoryId: cat.id, ...values };
  });
  if (Object.keys(errors).length > 0) return fail("Alcuni importi non sono validi: usa il formato 1234,50.", errors);

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const { marinaId: _m, priceListId: _l, categoryId: _c, ...values } = row;
      await tx
        .insert(rates)
        .values(row)
        .onConflictDoUpdate({ target: [rates.priceListId, rates.categoryId], set: values });
    }
    await audit(ctx, "modifica", "tariffe", list.id, list.name, tx);
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Tariffe salvate." };
}

const periodSchema = z.object({
  listId: f.id(),
  season: f.choice(["media", "alta"]),
  startDate: f.date(),
  endDate: f.date(),
});

export async function addSeasonPeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(periodSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { listId, ...data } = parsed.data;
  if (data.endDate < data.startDate) return fail("Controlla i campi evidenziati.", { endDate: "La fine precede l'inizio." });
  const list = await ownList(ctx.marinaId, listId);
  if (!list) return fail("Listino non trovato.");
  await db.insert(seasonPeriods).values({ marinaId: ctx.marinaId, priceListId: list.id, ...data });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteSeasonPeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const periodId = String(formData.get("periodId") ?? "");
  const deleted = await db
    .delete(seasonPeriods)
    .where(and(eq(seasonPeriods.id, periodId), eq(seasonPeriods.marinaId, ctx.marinaId)))
    .returning({ id: seasonPeriods.id });
  if (deleted.length === 0) return fail("Periodo non trovato.");
  revalidatePath("/", "layout");
  return { ok: true };
}

// Simulatore: quanto costa un periodo per una categoria, secondo il listino scelto.
export async function simulateQuote(input: { listId: string; categoryId: string; type: string; startDate: string; endDate: string }): Promise<Quote | null> {
  const ctx = await requireMarina(OFFICE);
  const types = ["annuale", "stagionale", "mensile", "transito"] as const;
  if (!types.includes(input.type as (typeof types)[number])) return null;
  if (!isValidISODate(input.startDate) || !isValidISODate(input.endDate) || input.endDate < input.startDate) return null;
  if (!z.uuid().safeParse(input.listId).success || !z.uuid().safeParse(input.categoryId).success) return null;

  const list = await ownList(ctx.marinaId, input.listId);
  if (!list) return null;
  const [[rate], periods] = await Promise.all([
    db
      .select()
      .from(rates)
      .where(and(eq(rates.priceListId, list.id), eq(rates.categoryId, input.categoryId), eq(rates.marinaId, ctx.marinaId)))
      .limit(1),
    db.select().from(seasonPeriods).where(eq(seasonPeriods.priceListId, list.id)),
  ]);
  if (!rate) return null;
  return quoteStay({ type: input.type as (typeof types)[number], startDate: input.startDate, endDate: input.endDate, rate, periods });
}
