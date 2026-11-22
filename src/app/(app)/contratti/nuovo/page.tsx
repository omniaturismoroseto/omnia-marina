import type { Metadata } from "next";
import { and, asc, eq, sql } from "drizzle-orm";
import { page } from "@/components/page";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { boats, marinas, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { isValidISODate, todayRome } from "@/lib/dates";
import { formatDimensions } from "@/lib/format";
import { one, uuidOrNull, type SearchParams } from "@/lib/params";
import { loadPlanMap } from "@/server/plan-map";
import { ContractForm } from "../contract-form";

export const metadata: Metadata = { title: "Nuovo contratto" };

export default page(async function NewContractPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(OFFICE);
  const sp = await searchParams;
  const today = todayRome();

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

  // Il modulo può arrivare già compilato dalla mappa (posto, data), dalla scheda cliente o dalla scheda barca.
  const boatParam = uuidOrNull(sp.barca);
  const boat = boatList.find((b) => b.id === boatParam);
  const ownerId = boat?.ownerId ?? uuidOrNull(sp.cliente) ?? "";
  const ownerBoats = boatList.filter((b) => b.ownerId === ownerId);
  const startDate = isValidISODate(one(sp.dal)) ? one(sp.dal) : today;
  const berthId = uuidOrNull(sp.posto) ?? "";

  // Schema del porto per «Scegli dalla mappa».
  const map = await loadPlanMap(ctx.marinaId);

  return (
    <>
      <PageHeader help="contratti" title="Nuovo contratto" description="Assegna un posto barca a un cliente per un periodo, con importo e scadenze di pagamento." back={{ href: "/contratti", label: "Contratti" }} />
      {ownerList.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Serve prima un cliente"
            description="Inserisci il cliente e la sua barca, poi torna qui per creare il contratto."
            action={<ButtonLink href="/clienti/nuovo" variant="primary">Nuovo cliente</ButtonLink>}
          />
        </div>
      ) : (
        <ContractForm
          owners={ownerList}
          boats={boatList.map((b) => ({ id: b.id, ownerId: b.ownerId, name: b.name, size: formatDimensions(b.lengthCm, b.beamCm) }))}
          today={today}
          defaultVatRate={marina.vat}
          fees={{ gestione: marina.serviceFee, rifiuti: marina.wasteFee }}
          map={map}
          initial={{
            ownerId: ownerList.some((o) => o.id === ownerId) ? ownerId : "",
            boatId: boat?.id ?? (ownerBoats.length === 1 ? ownerBoats[0].id : ""),
            berthId,
            startDate,
            type: berthId ? "transito" : "annuale",
          }}
        />
      )}
    </>
  );
});
