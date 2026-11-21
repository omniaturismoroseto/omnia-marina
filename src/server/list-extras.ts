import "server-only";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { priceListExtras, priceLists } from "@/db/schema";
import { SPACE_ITEM_KINDS } from "@/lib/contract-items";
import { withVat } from "@/lib/pricing";

/** Servizio o cauzione del listino, come lo si propone in un contratto. */
export interface ListExtra {
  id: string;
  name: string;
  amountCents: number;
  vatRate: number;
  // Voce del contratto collegata (posto auto, carrello, spazio a terra); vuota = servizio a sé (es. una cauzione).
  itemKind: (typeof SPACE_ITEM_KINDS)[number] | null;
}

/**
 * Servizi e cauzioni di un listino del porto, nell'ordine in cui compaiono nella pagina Tariffe.
 * Gli importi escono IVA compresa, come li vogliono i contratti, anche se il listino ha prezzi netti.
 */
export async function extrasOfList(marinaId: string, listId: string): Promise<ListExtra[]> {
  const rows = await db
    .select({
      id: priceListExtras.id,
      name: priceListExtras.name,
      kind: priceListExtras.itemKind,
      amountCents: priceListExtras.amountCents,
      vatRate: priceListExtras.vatRate,
      vatIncluded: priceLists.vatIncluded,
    })
    .from(priceListExtras)
    .innerJoin(priceLists, eq(priceLists.id, priceListExtras.priceListId))
    .where(and(eq(priceListExtras.priceListId, listId), eq(priceListExtras.marinaId, marinaId)))
    .orderBy(asc(priceListExtras.sortOrder), asc(priceListExtras.name));
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    amountCents: withVat(e.amountCents, e.vatRate, e.vatIncluded),
    vatRate: e.vatRate,
    itemKind: SPACE_ITEM_KINDS.find((k) => k === e.kind) ?? null,
  }));
}

/** Servizi e cauzioni del listino in vigore in una data (quella di inizio del contratto); vuoto se nessun listino la copre. */
export async function extrasForDate(marinaId: string, date: string): Promise<ListExtra[]> {
  const [list] = await db
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(and(eq(priceLists.marinaId, marinaId), lte(priceLists.validFrom, date), gte(priceLists.validTo, date)))
    .orderBy(desc(priceLists.validFrom))
    .limit(1);
  return list ? extrasOfList(marinaId, list.id) : [];
}
