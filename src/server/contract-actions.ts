"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { berthCategories, berths, boats, contracts, piers, priceLists, rates, seasonPeriods, type ContractType } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { isValidISODate } from "@/lib/dates";
import { formatDimensions } from "@/lib/format";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { categoryForBoat, occupiedUntil, quoteStay, type QuoteLine } from "@/lib/pricing";
import { activateContract, cancelContract, createContract } from "./contracts";
import { toFormState } from "./errors";

export interface BerthOption {
  id: string;
  code: string;
  pierName: string;
  size: string;
  available: boolean;
  reason: string | null;
}

export interface ContractOptions {
  berths: BerthOption[];
  quote: { listName: string; categoryName: string; lines: QuoteLine[]; totalCents: number; vatRate: number } | null;
  quoteNote: string | null;
}

const TYPES = ["annuale", "stagionale", "mensile", "transito"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Posti adatti e liberi per una barca in un periodo, e preventivo da listino. Usata dal modulo "nuovo contratto".
export async function loadContractOptions(input: {
  boatId: string;
  type: string;
  startDate: string;
  endDate: string;
  berthId: string | null;
}): Promise<ContractOptions> {
  const ctx = await requireMarina(OFFICE);
  const empty: ContractOptions = { berths: [], quote: null, quoteNote: null };
  if (!UUID.test(input.boatId) || !TYPES.includes(input.type as ContractType)) return empty;
  if (!isValidISODate(input.startDate) || !isValidISODate(input.endDate) || input.endDate < input.startDate) return empty;
  const type = input.type as ContractType;
  const berthId = input.berthId && UUID.test(input.berthId) ? input.berthId : null;

  const [boat] = await db
    .select()
    .from(boats)
    .where(and(eq(boats.id, input.boatId), eq(boats.marinaId, ctx.marinaId)))
    .limit(1);
  if (!boat) return empty;
  const until = occupiedUntil(type, input.startDate, input.endDate);

  const [berthRows, busyRows, categories, [list]] = await Promise.all([
    db
      .select({ berth: berths, pierName: piers.name })
      .from(berths)
      .innerJoin(piers, eq(piers.id, berths.pierId))
      .where(eq(berths.marinaId, ctx.marinaId))
      .orderBy(asc(piers.sortOrder), asc(berths.code)),
    db
      .select({ berthId: contracts.berthId })
      .from(contracts)
      .where(
        and(
          eq(contracts.marinaId, ctx.marinaId),
          inArray(contracts.status, ["attivo", "concluso"]),
          lt(contracts.startDate, until),
          gt(contracts.occupiedUntil, input.startDate),
        ),
      ),
    db.select().from(berthCategories).where(eq(berthCategories.marinaId, ctx.marinaId)),
    db
      .select()
      .from(priceLists)
      .where(and(eq(priceLists.marinaId, ctx.marinaId), lte(priceLists.validFrom, input.startDate), gte(priceLists.validTo, input.startDate)))
      .orderBy(desc(priceLists.validFrom))
      .limit(1),
  ]);

  const busy = new Set(busyRows.map((r) => r.berthId));
  const options: BerthOption[] = berthRows.map(({ berth, pierName }) => {
    const reason =
      berth.status !== "attivo"
        ? "non in servizio"
        : boat.lengthCm > berth.lengthCm || boat.beamCm > berth.beamCm
          ? "troppo piccolo"
          : busy.has(berth.id)
            ? "già assegnato"
            : null;
    return { id: berth.id, code: berth.code, pierName, size: formatDimensions(berth.lengthCm, berth.beamCm), available: reason === null, reason };
  });

  // La tariffa segue la categoria del posto scelto; senza posto, quella in cui rientra la barca.
  const chosen = berthId ? berthRows.find((r) => r.berth.id === berthId)?.berth : undefined;
  const category = chosen?.categoryId ? categories.find((c) => c.id === chosen.categoryId) : categoryForBoat(categories, boat);

  if (!list) return { berths: options, quote: null, quoteNote: "Nessun listino copre la data di inizio: inserisci l'importo a mano." };
  if (!category) return { berths: options, quote: null, quoteNote: "Nessuna categoria tariffaria adatta: inserisci l'importo a mano." };

  const [[rate], periods] = await Promise.all([
    db
      .select()
      .from(rates)
      .where(and(eq(rates.priceListId, list.id), eq(rates.categoryId, category.id)))
      .limit(1),
    db.select().from(seasonPeriods).where(eq(seasonPeriods.priceListId, list.id)),
  ]);
  if (!rate) return { berths: options, quote: null, quoteNote: `Il ${list.name} non ha tariffe per la categoria ${category.name}.` };

  const quote = quoteStay({ type, startDate: input.startDate, endDate: input.endDate, rate, periods });
  return {
    berths: options,
    quote: { listName: list.name, categoryName: category.name, lines: quote.lines, totalCents: quote.totalCents, vatRate: list.vatRate },
    quoteNote: quote.totalCents === 0 ? "Le tariffe di questa categoria non sono ancora compilate." : null,
  };
}

const planFields = {
  instalments: f.int(1, 12, "Da 1 a 12 rate"),
  firstDueDate: f.date("Indica la prima scadenza"),
  everyMonths: f.int(1, 12),
};

const contractSchema = z.object({
  ownerId: f.id("Scegli il cliente"),
  boatId: f.id("Scegli la barca"),
  berthId: f.optId(),
  type: f.choice(TYPES),
  startDate: f.date(),
  endDate: f.date(),
  amount: f.money(),
  vatRate: f.int(0, 30, "Aliquota non valida"),
  signedOn: f.optDate(),
  notes: f.optText(),
  intent: f.choice(["attivo", "bozza"]),
  ...planFields,
});

export async function saveContract(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(contractSchema, formData);
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  if (d.endDate < d.startDate) return fail("Controlla i campi evidenziati.", { endDate: "La fine precede l'inizio." });

  let created: { id: string; number: string };
  try {
    created = await db.transaction(async (tx) => {
      const result = await createContract(
        tx,
        { marinaId: ctx.marinaId, userId: ctx.user.id },
        {
          ownerId: d.ownerId,
          boatId: d.boatId,
          berthId: d.berthId,
          type: d.type,
          status: d.intent,
          startDate: d.startDate,
          endDate: d.endDate,
          amountCents: d.amount,
          vatRate: d.vatRate,
          signedOn: d.signedOn,
          notes: d.notes,
          instalments: { count: d.instalments, firstDueDate: d.firstDueDate, everyMonths: d.everyMonths },
        },
      );
      await audit(ctx, "creazione", "contratto", result.id, `${result.number} (${d.intent})`, tx);
      return result;
    });
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/", "layout");
  redirect(`/contratti/${created.id}`);
}

const activateSchema = z.object({ contractId: f.id(), ...planFields });

export async function activateContractAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(activateSchema, formData);
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  try {
    await db.transaction(async (tx) => {
      await activateContract(tx, { marinaId: ctx.marinaId, userId: ctx.user.id }, d.contractId, {
        count: d.instalments,
        firstDueDate: d.firstDueDate,
        everyMonths: d.everyMonths,
      });
      await audit(ctx, "attivazione", "contratto", d.contractId, undefined, tx);
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function cancelContractAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const contractId = String(formData.get("contractId") ?? "");
  if (!UUID.test(contractId)) return fail("Contratto non trovato.");
  try {
    await db.transaction(async (tx) => {
      await cancelContract(tx, { marinaId: ctx.marinaId, userId: ctx.user.id }, contractId);
      await audit(ctx, "annullamento", "contratto", contractId, undefined, tx);
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

const metaSchema = z.object({ contractId: f.id(), signedOn: f.optDate(), notes: f.optText() });

export async function updateContractMeta(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(metaSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { contractId, signedOn, notes } = parsed.data;
  const updated = await db
    .update(contracts)
    .set({ signedOn, notes, updatedAt: new Date() })
    .where(and(eq(contracts.id, contractId), eq(contracts.marinaId, ctx.marinaId)))
    .returning({ id: contracts.id });
  if (updated.length === 0) return fail("Contratto non trovato.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Salvato." };
}
