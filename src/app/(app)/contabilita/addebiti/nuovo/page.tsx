import type { Metadata } from "next";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { page } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { boats, contracts, marinas, owners, priceListExtras, priceLists } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { todayRome } from "@/lib/dates";
import { uuidOrNull, type SearchParams } from "@/lib/params";
import { ChargeForm } from "../../accounting-forms";

export const metadata: Metadata = { title: "Nuovo addebito" };

export default page(async function NewChargePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(OFFICE);
  const ownerParam = uuidOrNull((await searchParams).cliente);
  const today = todayRome();

  const [ownerList, contractList, [marina], extras] = await Promise.all([
    db
      .select({ id: owners.id, name: owners.displayName })
      .from(owners)
      .where(and(eq(owners.marinaId, ctx.marinaId), sql`${owners.anonymizedAt} is null`))
      .orderBy(asc(owners.displayName)),
    db
      .select({ id: contracts.id, ownerId: contracts.ownerId, number: contracts.number, boatName: boats.name })
      .from(contracts)
      .innerJoin(boats, eq(boats.id, contracts.boatId))
      .where(and(eq(contracts.marinaId, ctx.marinaId), inArray(contracts.status, ["attivo", "concluso"])))
      .orderBy(desc(contracts.startDate))
      .limit(1000),
    db.select({ vat: marinas.defaultVatRate }).from(marinas).where(eq(marinas.id, ctx.marinaId)),
    // Servizi a prezzo fisso del listino in vigore oggi.
    db
      .select({ id: priceListExtras.id, name: priceListExtras.name, amountCents: priceListExtras.amountCents, vatRate: priceListExtras.vatRate })
      .from(priceListExtras)
      .where(
        eq(
          priceListExtras.priceListId,
          db
            .select({ id: priceLists.id })
            .from(priceLists)
            .where(and(eq(priceLists.marinaId, ctx.marinaId), lte(priceLists.validFrom, today), gte(priceLists.validTo, today)))
            .orderBy(desc(priceLists.validFrom))
            .limit(1),
        ),
      )
      .orderBy(asc(priceListExtras.sortOrder), asc(priceListExtras.name)),
  ]);

  return (
    <>
      <PageHeader
        title="Nuovo addebito"
        description="Per servizi, utenze o altri importi da incassare. Le rate di ormeggio nascono in automatico dal contratto."
        back={{ href: "/contabilita", label: "Scadenziario" }}
      />
      <ChargeForm
        owners={ownerList}
        contracts={contractList.map((c) => ({ id: c.id, ownerId: c.ownerId, label: `${c.number} · ${c.boatName}` }))}
        today={today}
        defaultVatRate={marina.vat}
        initialOwnerId={ownerList.some((o) => o.id === ownerParam) ? ownerParam! : ""}
        extras={extras}
      />
    </>
  );
});
