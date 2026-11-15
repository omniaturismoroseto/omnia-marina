import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { berthCategories, priceListExtras, priceLists, rates, tariffZones, type ContractItemKind } from "@/db/schema";

// Listino ufficiale 2026 di Marina Portorose, dal foglio TARIFFE_2026_UFFICIALI.xls.
// Il prezzo dipende dalla lunghezza fuori tutto (pulpiti, spiaggette e delfiniere compresi) e dalla darsena:
// le darsene A, B e D usano la tariffa base, la darsena C ha prezzi propri (zona tariffaria «Darsena C»).
// Il foglio non indica le larghezze: quelle qui sotto sono indicative e si correggono in Impostazioni → Categorie.
// Importi in euro, IVA inclusa.

export const OFFICIAL_LIST = { name: "Listino 2026", validFrom: "2026-01-01", validTo: "2026-12-31", vatRate: 22 };
export const OFFICIAL_ZONE = "Darsena C";

interface Prices {
  annual: number;
  waste: number;
  seasonal?: number; // maggio – settembre, a corpo
  monthly?: number;
}

interface TemplateCategory {
  name: string;
  maxLengthCm: number;
  maxBeamCm: number;
  base: Prices | null; // darsene A, B, D (null: categoria presente solo nella darsena C)
  zone: Prices; // darsena C
}

export const OFFICIAL_CATEGORIES: TemplateCategory[] = [
  {
    name: "B · fino a 6 m",
    maxLengthCm: 600,
    maxBeamCm: 250,
    base: { annual: 1310, waste: 40, seasonal: 900, monthly: 250 },
    zone: { annual: 1460, waste: 40, seasonal: 900, monthly: 250 },
  },
  {
    name: "C · fino a 7 m",
    maxLengthCm: 700,
    maxBeamCm: 280,
    base: { annual: 1610, waste: 50, seasonal: 1100, monthly: 300 },
    zone: { annual: 1710, waste: 50, seasonal: 1100, monthly: 300 },
  },
  { name: "D · fino a 8 m", maxLengthCm: 800, maxBeamCm: 300, base: { annual: 1760, waste: 60 }, zone: { annual: 1960, waste: 60 } },
  { name: "E · fino a 9 m", maxLengthCm: 900, maxBeamCm: 330, base: { annual: 2000, waste: 70 }, zone: { annual: 2200, waste: 70 } },
  { name: "F · fino a 10 m", maxLengthCm: 1000, maxBeamCm: 350, base: { annual: 2100, waste: 90 }, zone: { annual: 2450, waste: 90 } },
  { name: "G · fino a 11 m", maxLengthCm: 1100, maxBeamCm: 380, base: { annual: 2300, waste: 90 }, zone: { annual: 2800, waste: 90 } },
  { name: "H · fino a 12 m", maxLengthCm: 1200, maxBeamCm: 420, base: null, zone: { annual: 3200, waste: 90 } },
  { name: "I · oltre 12 m", maxLengthCm: 1800, maxBeamCm: 550, base: null, zone: { annual: 3500, waste: 90 } },
];

// itemKind: la voce del contratto di cui il servizio propone l'importo.
export const OFFICIAL_EXTRAS: { name: string; amount: number; vatRate: number; itemKind?: ContractItemKind }[] = [
  { name: "Posto auto coperto", amount: 400, vatRate: 22, itemKind: "auto_coperto" },
  { name: "Posto auto scoperto", amount: 210, vatRate: 22, itemKind: "auto_scoperto" },
  { name: "Carrelli / invasi", amount: 140, vatRate: 22, itemKind: "carrello" },
  { name: "Posto auto scoperto estivo", amount: 105, vatRate: 22 },
  { name: "Cauzione pass cancello", amount: 30, vatRate: 0 },
  { name: "Cauzione sbarra interna", amount: 40, vatRate: 0 },
];

const cents = (euro: number | undefined) => Math.round((euro ?? 0) * 100);

function rateValues(p: Prices) {
  const monthly = cents(p.monthly);
  return {
    annual: cents(p.annual),
    waste: cents(p.waste),
    seasonal: cents(p.seasonal),
    monthlyLow: monthly,
    monthlyMid: monthly,
    monthlyHigh: monthly,
    dailyLow: 0,
    dailyMid: 0,
    dailyHigh: 0,
  };
}

/**
 * Carica il listino ufficiale: crea le categorie e la zona «Darsena C» se mancano (per nome), il listino 2026
 * se non c'è, scrive le tariffe base e quelle della zona e aggiunge i servizi non ancora presenti.
 * Si può ripetere: non duplica nulla e non tocca le altre categorie, i pontili né i posti barca.
 */
export async function loadOfficialPriceList(tx: Tx, marinaId: string): Promise<{ listId: string; zoneId: string; createdCategories: number }> {
  const existing = await tx.select().from(berthCategories).where(eq(berthCategories.marinaId, marinaId));
  const categoryIds = new Map(existing.map((c) => [c.name, c.id]));
  let createdCategories = 0;
  for (const [i, c] of OFFICIAL_CATEGORIES.entries()) {
    if (categoryIds.has(c.name)) continue;
    const [row] = await tx
      .insert(berthCategories)
      .values({ marinaId, name: c.name, maxLengthCm: c.maxLengthCm, maxBeamCm: c.maxBeamCm, sortOrder: 100 + i })
      .returning({ id: berthCategories.id });
    categoryIds.set(c.name, row.id);
    createdCategories++;
  }

  let [zone] = await tx
    .select({ id: tariffZones.id })
    .from(tariffZones)
    .where(and(eq(tariffZones.marinaId, marinaId), eq(tariffZones.name, OFFICIAL_ZONE)))
    .limit(1);
  if (!zone) [zone] = await tx.insert(tariffZones).values({ marinaId, name: OFFICIAL_ZONE }).returning({ id: tariffZones.id });

  let [list] = await tx
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(and(eq(priceLists.marinaId, marinaId), eq(priceLists.name, OFFICIAL_LIST.name)))
    .limit(1);
  if (!list) [list] = await tx.insert(priceLists).values({ marinaId, ...OFFICIAL_LIST }).returning({ id: priceLists.id });

  for (const c of OFFICIAL_CATEGORIES) {
    const categoryId = categoryIds.get(c.name)!;
    const rows: { zoneId: string | null; prices: Prices }[] = [{ zoneId: zone.id, prices: c.zone }];
    if (c.base) rows.push({ zoneId: null, prices: c.base });
    for (const { zoneId, prices } of rows) {
      const values = rateValues(prices);
      await tx
        .insert(rates)
        .values({ marinaId, priceListId: list.id, categoryId, zoneId, ...values })
        .onConflictDoUpdate({ target: [rates.priceListId, rates.categoryId, rates.zoneId], set: values });
    }
  }

  const extras = await tx.select({ name: priceListExtras.name }).from(priceListExtras).where(eq(priceListExtras.priceListId, list.id));
  const have = new Set(extras.map((e) => e.name.toLowerCase()));
  const missing = OFFICIAL_EXTRAS.filter((e) => !have.has(e.name.toLowerCase()));
  if (missing.length > 0) {
    await tx.insert(priceListExtras).values(
      missing.map((e, i) => ({
        marinaId,
        priceListId: list.id,
        name: e.name,
        amountCents: cents(e.amount),
        vatRate: e.vatRate,
        itemKind: e.itemKind ?? null,
        sortOrder: extras.length + i,
      })),
    );
  }

  return { listId: list.id, zoneId: zone.id, createdCategories };
}
