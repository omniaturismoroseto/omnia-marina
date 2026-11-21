"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { berthCategories, piers, priceListExtras, priceLists, rates, seasonPeriods } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { ITEM_KINDS } from "@/lib/contract-items";
import { addMonths, isValidISODate } from "@/lib/dates";
import { parseMoney } from "@/lib/format";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { RATE_FIELDS, pierGroupKey, pierRate, quoteStay, ratePierId, type Quote } from "@/lib/pricing";
import { loadOfficialPriceList, OFFICIAL_LIST } from "./official-price-list";

const ADMIN = ["admin" as const];

async function ownList(marinaId: string, listId: string) {
  const [list] = await db
    .select()
    .from(priceLists)
    .where(and(eq(priceLists.id, listId), eq(priceLists.marinaId, marinaId)))
    .limit(1);
  return list ?? null;
}

// Pontile del porto: gli identificativi arrivano dal browser e vanno verificati contro il porto della sessione.
async function ownPier(marinaId: string, pierId: string) {
  if (!z.uuid().safeParse(pierId).success) return null;
  const [pier] = await db
    .select({ id: piers.id, name: piers.name, baseRate: piers.baseRate })
    .from(piers)
    .where(and(eq(piers.id, pierId), eq(piers.marinaId, marinaId)))
    .limit(1);
  return pier ?? null;
}

// Il pontile e quelli del porto con lo stesso nome: in Tariffe sono una scheda sola e condividono i prezzi.
async function ownPierGroup(marinaId: string, pierId: string) {
  const pier = await ownPier(marinaId, pierId);
  if (!pier) return null;
  const all = await db.select({ id: piers.id, name: piers.name, baseRate: piers.baseRate }).from(piers).where(eq(piers.marinaId, marinaId));
  const key = pierGroupKey(pier.name);
  const members = all.filter((p) => pierGroupKey(p.name) === key);
  // Come nella pagina: il gruppo usa la tariffa base solo se la usano tutti; `mixed` se non sono allineati.
  const baseRate = members.every((p) => p.baseRate);
  return { ...pier, ids: members.map((p) => p.id), baseRate, mixed: members.some((p) => p.baseRate !== baseRate) };
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

// Salva l'intera griglia delle tariffe di un pontile (o della tariffa base): un campo per ogni categoria e colonna,
// chiamato "categoria:colonna". Nei pontili le caselle vuote valgono zero, cioè «come la tariffa base».
export async function saveRates(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const list = await ownList(ctx.marinaId, String(formData.get("listId") ?? ""));
  if (!list) return fail("Listino non trovato.");
  const pierField = String(formData.get("pierId") ?? "");
  const pier = pierField ? await ownPierGroup(ctx.marinaId, pierField) : null;
  if (pierField && !pier) return fail("Pontile non trovato.");
  // I prezzi di un pontile valgono anche per quelli con lo stesso nome.
  const targets: (string | null)[] = pier ? pier.ids : [null];
  const categories = await db.select({ id: berthCategories.id }).from(berthCategories).where(eq(berthCategories.marinaId, ctx.marinaId));

  const errors: Record<string, string> = {};
  const rows = categories.flatMap((cat) => {
    const values = {} as Record<(typeof RATE_FIELDS)[number], number>;
    for (const field of RATE_FIELDS) {
      const key = `${cat.id}:${field}`;
      const raw = String(formData.get(key) ?? "").trim();
      const cents = raw === "" ? 0 : parseMoney(raw);
      if (cents === null || cents < 0) errors[key] = "Importo non valido";
      values[field] = cents ?? 0;
    }
    return targets.map((pierId) => ({ marinaId: ctx.marinaId, priceListId: list.id, categoryId: cat.id, pierId, ...values }));
  });
  if (Object.keys(errors).length > 0) return fail("Alcuni importi non sono validi: usa il formato 1234,50.", errors);

  await db.transaction(async (tx) => {
    // Pontili con lo stesso nome ma impostati diversamente: si allineano a quello che mostra la scheda.
    if (pier?.mixed) await tx.update(piers).set({ baseRate: pier.baseRate }).where(and(inArray(piers.id, pier.ids), eq(piers.marinaId, ctx.marinaId)));
    for (const row of rows) {
      const { marinaId: _m, priceListId: _l, categoryId: _c, pierId: _p, ...values } = row;
      await tx
        .insert(rates)
        .values(row)
        .onConflictDoUpdate({ target: [rates.priceListId, rates.categoryId, rates.pierId], set: values });
    }
    await audit(ctx, "modifica", "tariffe", list.id, pier ? `${list.name} · ${pier.name}` : list.name, tx);
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

// Modifica di un servizio o di una cauzione già nel listino: nome, importo, IVA e voce del contratto collegata.
const extraUpdateSchema = extraSchema.omit({ listId: true }).extend({ extraId: f.id() });

export async function updatePriceListExtra(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(extraUpdateSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { extraId, name, amount, vatRate, itemKind } = parsed.data;
  const updated = await db
    .update(priceListExtras)
    .set({ name, amountCents: amount, vatRate, itemKind })
    .where(and(eq(priceListExtras.id, extraId), eq(priceListExtras.marinaId, ctx.marinaId)))
    .returning({ listId: priceListExtras.priceListId });
  if (updated.length === 0) return fail("Voce non trovata.");
  await audit(ctx, "modifica", "tariffe", updated[0].listId, `Modificato ${name}`);
  revalidatePath("/", "layout");
  return { ok: true, message: "Salvato." };
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

// Simulatore: quanto costa un periodo per una categoria su un pontile (vuoto = tariffa base), secondo il listino scelto.
// Un pontile che usa la tariffa base dà gli stessi importi della tariffa base.
export async function simulateQuote(input: {
  listId: string;
  categoryId: string;
  pierId: string;
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
  const pier = input.pierId ? await ownPier(ctx.marinaId, input.pierId) : null;
  if (input.pierId && !pier) return null;
  const pierId = ratePierId(pier);
  const [rateRows, periods] = await Promise.all([
    db
      .select()
      .from(rates)
      .where(
        and(
          eq(rates.priceListId, list.id),
          eq(rates.categoryId, input.categoryId),
          eq(rates.marinaId, ctx.marinaId),
          pierId ? or(isNull(rates.pierId), eq(rates.pierId, pierId)) : isNull(rates.pierId),
        ),
      ),
    db.select().from(seasonPeriods).where(eq(seasonPeriods.priceListId, list.id)),
  ]);
  const rate = pierRate(rateRows, pierId);
  if (!rate) return null;
  const type = input.type as (typeof types)[number];
  return { ...quoteStay({ type, startDate: input.startDate, endDate: input.endDate, rate, periods }), wasteCents: type === "annuale" ? rate.waste : 0 };
}

// ───────────────────────── Tariffa base e pontili ─────────────────────────

// Sceglie in un colpo solo i pontili a cui si applica la tariffa base: un campo "base" ripetuto con l'id di ogni
// pontile spuntato. Gli altri usano i propri prezzi. Vale per tutti i listini.
export async function saveBaseRatePiers(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const pierRows = await db.select({ id: piers.id, name: piers.name, baseRate: piers.baseRate }).from(piers).where(eq(piers.marinaId, ctx.marinaId));
  // Spuntare un nome vale per tutti i pontili che lo portano.
  const picked = new Set(formData.getAll("base").map(String));
  const keys = new Set(pierRows.filter((p) => picked.has(p.id)).map((p) => pierGroupKey(p.name)));
  const chosen = new Set(pierRows.filter((p) => keys.has(pierGroupKey(p.name))).map((p) => p.id));
  const on = pierRows.filter((p) => chosen.has(p.id) && !p.baseRate).map((p) => p.id);
  const off = pierRows.filter((p) => !chosen.has(p.id) && p.baseRate).map((p) => p.id);
  if (on.length === 0 && off.length === 0) return { ok: true, message: "Nessuna modifica." };

  await db.transaction(async (tx) => {
    if (on.length > 0) await tx.update(piers).set({ baseRate: true }).where(and(eq(piers.marinaId, ctx.marinaId), inArray(piers.id, on)));
    if (off.length > 0) await tx.update(piers).set({ baseRate: false }).where(and(eq(piers.marinaId, ctx.marinaId), inArray(piers.id, off)));
    await audit(ctx, "modifica", "tariffe", null, `Tariffa base su ${chosen.size} pontili su ${pierRows.length}`, tx);
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Salvato." };
}

// Accende o spegne la tariffa base per un pontile solo (dalla sua scheda in Tariffe).
export async function setPierBaseRate(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const pier = await ownPierGroup(ctx.marinaId, String(formData.get("pierId") ?? ""));
  if (!pier) return fail("Pontile non trovato.");
  const baseRate = formData.get("baseRate") === "1";
  await db.update(piers).set({ baseRate }).where(and(inArray(piers.id, pier.ids), eq(piers.marinaId, ctx.marinaId)));
  await audit(ctx, "modifica", "tariffe", null, `${pier.name}: ${baseRate ? "usa la tariffa base" : "usa i suoi prezzi"}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// Copia nella griglia di un pontile, per un listino, i prezzi della tariffa base o di un altro pontile.
// Utile quando più pontili (es. quelli di una darsena) hanno gli stessi prezzi.
export async function copyPierRates(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const list = await ownList(ctx.marinaId, String(formData.get("listId") ?? ""));
  if (!list) return fail("Listino non trovato.");
  const target = await ownPierGroup(ctx.marinaId, String(formData.get("pierId") ?? ""));
  if (!target) return fail("Pontile non trovato.");
  const fromField = String(formData.get("from") ?? "");
  const source = fromField ? await ownPier(ctx.marinaId, fromField) : null;
  if (fromField && !source) return fail("Scegli da dove copiare i prezzi.");
  if (source && target.ids.includes(source.id)) return fail("Scegli un altro pontile da cui copiare.");

  const copied = await db.transaction(async (tx) => {
    const sourceRows = await tx
      .select()
      .from(rates)
      .where(and(eq(rates.priceListId, list.id), eq(rates.marinaId, ctx.marinaId), source ? eq(rates.pierId, source.id) : isNull(rates.pierId)));
    await tx.delete(rates).where(and(eq(rates.priceListId, list.id), eq(rates.marinaId, ctx.marinaId), inArray(rates.pierId, target.ids)));
    if (sourceRows.length > 0) {
      await tx.insert(rates).values(target.ids.flatMap((pierId) => sourceRows.map(({ id: _id, pierId: _p, ...r }) => ({ ...r, pierId }))));
    }
    await audit(ctx, "modifica", "tariffe", list.id, `${list.name} · ${target.name}: prezzi copiati da ${source?.name ?? "tariffa base"}`, tx);
    return sourceRows.length;
  });
  revalidatePath("/", "layout");
  return copied > 0 ? { ok: true, message: "Prezzi copiati." } : { ok: true, message: "Non c'erano prezzi da copiare: la griglia è vuota." };
}
