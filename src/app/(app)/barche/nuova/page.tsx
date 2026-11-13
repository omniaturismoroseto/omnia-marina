import type { Metadata } from "next";
import { and, asc, eq, sql } from "drizzle-orm";
import { page } from "@/components/page";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { uuidOrNull, type SearchParams } from "@/lib/params";
import { BoatForm } from "../boat-form";

export const metadata: Metadata = { title: "Nuova barca" };

export default page(async function NewBoatPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(OFFICE);
  const ownerId = uuidOrNull((await searchParams).cliente);
  const ownerList = await db
    .select({ id: owners.id, name: owners.displayName })
    .from(owners)
    .where(and(eq(owners.marinaId, ctx.marinaId), sql`${owners.anonymizedAt} is null`))
    .orderBy(asc(owners.displayName));

  return (
    <>
      <PageHeader title="Nuova barca" back={ownerId ? { href: `/clienti/${ownerId}`, label: "Scheda cliente" } : { href: "/barche", label: "Barche" }} />
      {ownerList.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Serve prima un cliente"
            description="Ogni barca è intestata a un proprietario: inserisci prima il cliente."
            action={<ButtonLink href="/clienti/nuovo" variant="primary">Nuovo cliente</ButtonLink>}
          />
        </div>
      ) : (
        <BoatForm owners={ownerList} boat={ownerId ? { ownerId } : undefined} />
      )}
    </>
  );
});
