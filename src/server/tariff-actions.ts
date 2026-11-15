"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { berthCategories, piers, priceListExtras, priceLists, rates, seasonPeriods, tariffZones } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { ITEM_KINDS } from "@/lib/contract-items";
import { addMonths, isValidISODate } from "@/lib/dates";
import { parseMoney } from "@/lib/format";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { RATE_FIELDS, quoteStay, zoneRate, type Quote } from "@/lib/pricing";
import { loadOfficialPriceList, OFFICIAL_LIST } from "./official-price-list";
import { toFormState } from "./errors";

const ADMIN = ["admin" as const];

async function ownList(marinaId: string, listId: string) {
  const [list] = await db
    .select()
    .from(priceLists)
    .where(and(eq(priceLists.id, listId), eq(priceLists.marinaId, marinaId)))
    .limit(1);
  return list ?? null;
}

// Zona del porto: gli identificativi arrivano dal browser e vanno verificati contro il porto della sessione.
async function ownZone(marinaId: string, zoneId: string) {
  if (!z.uuid().safeParse(zoneId).success) return null;
  const [zone] = await db
    .select()
    .from(tariffZones)
    .where(and(eq(tariffZones.id, zoneId), eq(tariffZones.marinaId, marinaId)))
    .limit(1);
  return zone ?? null;
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
    const extras = await tx.select().from(priceListExtras).where(eq(priceListExtras.priceListId, source.id));
    if (extras.length > 0) {
      await tx.insert(priceListExtras).values(extras.map(({ id: _id, priceListId: _list, ...e }) => ({ ...e, priceListId: created.id })));
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

// Salva l'intera griglia delle tariffe di una zona (o della tariffa base): un campo per ogni categoria e colonna,
// chiamato "categoria:colonna". Nelle zone le caselle vuote valgono zero, cioè «come la tariffa base».
export async function saveRates(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const list = await ownList(ctx.marinaId, String(formData.get("listId") ?? ""));
  if (!list) return fail("Listino non trovato.");
  const zoneField = String(formData.get("zoneId") ?? "");
  const zone = zoneField ? await ownZone(ctx.marinaId, zoneField) : null;
  if (zoneField && !zone) return fail("Zona non trovata.");
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
    return { marinaId: ctx.marinaId, priceListId: list.id, categoryId: cat.id, zoneId: zone?.id ?? null, ...values };
  });
  if (Object.keys(errors).length > 0) return fail("Alcuni importi non sono validi: usa il formato 1234,50.", errors);

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const { marinaId: _m, priceListId: _l, categoryId: _c, zoneId: _z, ...values } = row;
      await tx
        .insert(rates)
        .values(row)
        .onConflictDoUpdate({ target: [rates.priceListId, rates.categoryId, rates.zoneId], set: values });
    }
    await audit(ctx, "modifica", "tariffe", list.id, zone ? `${list.name} · ${zone.name}` : list.name, tx);
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

// Carica il listino ufficiale 2026 (categorie per darsena, tariffe, servizi). Si può ripetere senza duplicare.
export async function loadOfficialPriceListAction(_prev: FormState, _formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const { listId } = await db.transaction(async (tx) => {
    const result = await loadOfficialPriceList(tx, ctx.marinaId);
    await audit(ctx, "modifica", "tariffe", result.listId, `${OFFICIAL_LIST.name}: caricato il listino ufficiale (${result.createdCategories} categorie nuove)`, tx);
    return result;
  });
  revalidatePath("/", "layout");
  redirect(`/tariffe?listino=${listId}`);
}

// ───────────── Servizi e cauzioni a prezzo fisso ─────────────

const extraSchema = z.object({
  listId: f.id(),
  name: f.text("Scrivi il nome del servizio"),
  amount: f.money(),
  vatRate: f.int(0, 30, "Aliquota non valida"),
  itemKind: z.preprocess((v) => (typeof v === "string" && v !== "" ? v : null), z.enum(ITEM_KINDS, "Voce non valida").nullable()),
});

export async function addPriceListExtra(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(extraSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { listId, name, amount, vatRate, itemKind } = parsed.data;
  const list = await ownList(ctx.marinaId, listId);
  if (!list) return fail("Listino non trovato.");
  const existing = await db.select({ id: priceListExtras.id }).from(priceListExtras).where(eq(priceListExtras.priceListId, list.id));
  await db.insert(priceListExtras).values({ marinaId: ctx.marinaId, priceListId: list.id, name, amountCents: amount, vatRate, itemKind, sortOrder: existing.length });
  await audit(ctx, "modifica", "tariffe", list.id, `${list.name}: aggiunto ${name}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deletePriceListExtra(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const extraId = String(formData.get("extraId") ?? "");
  if (!z.uuid().safeParse(extraId).success) return fail("Voce non trovata.");
  const deleted = await db
    .delete(priceListExtras)
    .where(and(eq(priceListExtras.id, extraId), eq(priceListExtras.marinaId, ctx.marinaId)))
    .returning({ name: priceListExtras.name, listId: priceListExtras.priceListId });
  if (deleted.length === 0) return fail("Voce non trovata.");
  await audit(ctx, "modifica", "tariffe", deleted[0].listId, `Tolto ${deleted[0].name}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// Simulatore: quanto costa un periodo per una categoria in una zona (vuota = tariffa base), secondo il listino scelto.
export async function simulateQuote(input: {
  listId: string;
  categoryId: string;
  zoneId: string;
  type: string;
  startDate: string;
  endDate: string;
}): Promise<(Quote & { wasteCents: number }) | null> {
  const ctx = await requireMarina(OFFICE);
  const types = ["annuale", "stagionale", "mensile", "transito"] as const;
  if (!types.includes(input.type as (typeof types)[number])) return null;
  if (!isValidISODate(input.startDate) || !isValidISODate(input.endDate) || input.endDate < input.startDate) return null;
  if (!z.uuid().safeParse(input.listId).success || !z.uuid().safeParse(input.categoryId).success) return null;

  const list = await ownList(ctx.marinaId, input.listId);
  if (!list) return null;
  const zone = input.zoneId ? await ownZone(ctx.marinaId, input.zoneId) : null;
  if (input.zoneId && !zone) return null;
  const [rateRows, periods] = await Promise.all([
    db
      .select()
      .from(rates)
      .where(
        and(
          eq(rates.priceListId, list.id),
          eq(rates.categoryId, input.categoryId),
          eq(rates.marinaId, ctx.marinaId),
          zone ? or(isNull(rates.zoneId), eq(rates.zoneId, zone.id)) : isNull(rates.zoneId),
        ),
      ),
    db.select().from(seasonPeriods).where(eq(seasonPeriods.priceListId, list.id)),
  ]);
  const rate = zoneRate(rateRows, zone?.id ?? null);
  if (!rate) return null;
  const type = input.type as (typeof types)[number];
  return { ...quoteStay({ type, startDate: input.startDate, endDate: input.endDate, rate, periods }), wasteCents: type === "annuale" ? rate.waste : 0 };
}

// ───────────────────────── Zone tariffarie ─────────────────────────

const zoneSchema = z.object({
  id: f.optId(),
  name: f.text("Dai un nome alla zona"),
});

export async function saveTariffZone(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(zoneSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { id, name } = parsed.data;
  const existing = await db.select({ id: tariffZones.id, name: tariffZones.name }).from(tariffZones).where(eq(tariffZones.marinaId, ctx.marinaId));
  if (existing.some((z) => z.id !== id && z.name.toLowerCase() === name.toLowerCase())) {
    return fail("Controlla i campi evidenziati.", { name: "Esiste già una zona con questo nome." });
  }
  try {
    if (id) {
      const updated = await db
        .update(tariffZones)
        .set({ name })
        .where(and(eq(tariffZones.id, id), eq(tariffZones.marinaId, ctx.marinaId)))
        .returning({ id: tariffZones.id });
      if (updated.length === 0) return fail("Zona non trovata.");
      await audit(ctx, "modifica", "zona tariffaria", id, name);
    } else {
      const [created] = await db
        .insert(tariffZones)
        .values({ marinaId: ctx.marinaId, name, sortOrder: existing.length })
        .returning({ id: tariffZones.id });
      await audit(ctx, "creazione", "zona tariffaria", created.id, name);
    }
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: id ? "Salvato." : "Zona creata: ora assegnale i pontili e compila i suoi prezzi." };
}

export async function deleteTariffZone(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const zoneId = String(formData.get("zoneId") ?? "");
  const zone = await ownZone(ctx.marinaId, zoneId);
  if (!zone) return fail("Zona non trovata.");
  // I pontili tornano alla tariffa base (vincolo «set null»), i prezzi della zona si cancellano con lei.
  await db.delete(tariffZones).where(and(eq(tariffZones.id, zone.id), eq(tariffZones.marinaId, ctx.marinaId)));
  await audit(ctx, "eliminazione", "zona tariffaria", zone.id, zone.name);
  revalidatePath("/", "layout");
  redirect("/tariffe");
}

// Assegna in un colpo solo la zona di ogni pontile: un campo "pier:<id>" con l'id della zona, vuoto per la tariffa base.
export async function savePierZones(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const [pierRows, zoneRows] = await Promise.all([
    db.select({ id: piers.id, name: piers.name, zoneId: piers.tariffZoneId }).from(piers).where(eq(piers.marinaId, ctx.marinaId)),
    db.select({ id: tariffZones.id }).from(tariffZones).where(eq(tariffZones.marinaId, ctx.marinaId)),
  ]);
  const zoneIds = new Set(zoneRows.map((z) => z.id));
  const changes = new Map<string | null, string[]>();
  for (const pier of pierRows) {
    const raw = formData.get(`pier:${pier.id}`);
    if (raw === null) continue;
    const zoneId = String(raw) || null;
    if (zoneId && !zoneIds.has(zoneId)) return fail("Zona non valida.");
    if (zoneId === pier.zoneId) continue;
    changes.set(zoneId, [...(changes.get(zoneId) ?? []), pier.id]);
  }
  if (changes.size === 0) return { ok: true, message: "Nessuna modifica." };

  await db.transaction(async (tx) => {
    for (const [zoneId, pierIds] of changes) {
      await tx
        .update(piers)
        .set({ tariffZoneId: zoneId })
        .where(and(eq(piers.marinaId, ctx.marinaId), inArray(piers.id, pierIds)));
    }
    await audit(ctx, "modifica", "zona tariffaria", null, "Zone dei pontili", tx);
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Zone dei pontili salvate." };
}
