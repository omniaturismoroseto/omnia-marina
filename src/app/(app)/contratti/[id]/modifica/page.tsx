import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { page } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { boats, contracts, marinas, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { todayRome } from "@/lib/dates";
import { formatDimensions } from "@/lib/format";
import { uuidOrNull } from "@/lib/params";
import { loadPlanMap } from "@/server/plan-map";
import { ContractForm } from "../../contract-form";

export const metadata: Metadata = { title: "Modifica bozza" };

// Modifica di un contratto in bozza: stesso modulo del nuovo contratto, già compilato.
export default page(async function EditDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();

  const [c] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, id), eq(contracts.marinaId, ctx.marinaId)))
    .limit(1);
  if (!c) notFound();
  // Solo le bozze si modificano: un contratto attivo va prima riportato in bozza dalla sua scheda.
  if (c.status !== "bozza") redirect(`/contratti/${id}`);

  const [ownerList, boatList, [marina]] = await Promise.all([
    db
      .select({ id: owners.id, name: owners.displayName })
      .from(owners)
      .where(and(eq(owners.marinaId, ctx.marinaId), sql`${owners.anonymizedAt} is null`))
      .orderBy(asc(owners.displayName)),
    db
      .select({ id: boats.id, ownerId: boats.ownerId, name: boats.name, lengthCm: boats.lengthCm, beamCm: boats.beamCm })
      .from(boats)
      .where(eq(boats.marinaId, ctx.marinaId))
      .orderBy(asc(boats.name)),
    db.select({ vat: marinas.defaultVatRate, serviceFee: marinas.serviceFeeCents, wasteFee: marinas.wasteFeeCents }).from(marinas).where(eq(marinas.id, ctx.marinaId)),
  ]);

  // Schema del porto per «Scegli dalla mappa».
  const map = await loadPlanMap(ctx.marinaId);

  return (
    <>
      <PageHeader
        title="Modifica bozza"
        description="Cliente, barca, periodo, posto e importo. Posti auto, cauzioni e altre voci si cambiano dalla scheda del contratto; rate e scadenze si scelgono all'attivazione."
        back={{ href: `/contratti/${id}`, label: "Scheda del contratto" }}
      />
      <ContractForm
        owners={ownerList}
        boats={boatList.map((b) => ({ id: b.id, ownerId: b.ownerId, name: b.name, size: formatDimensions(b.lengthCm, b.beamCm) }))}
        today={todayRome()}
        defaultVatRate={marina.vat}
        fees={{ gestione: marina.serviceFee, rifiuti: marina.wasteFee }}
        map={map}
        initial={{ ownerId: c.ownerId, boatId: c.boatId, berthId: c.berthId ?? "", startDate: c.startDate, type: c.type }}
        draft={{ contractId: c.id, endDate: c.endDate, amountCents: c.amountCents, vatRate: c.vatRate, signedOn: c.signedOn, notes: c.notes }}
      />
    </>
  );
});
