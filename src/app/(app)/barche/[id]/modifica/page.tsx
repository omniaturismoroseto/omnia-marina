import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { page } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { boats, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { metersInput, moneyInput } from "@/lib/format";
import { uuidOrNull } from "@/lib/params";
import { BoatForm } from "../../boat-form";

export const metadata: Metadata = { title: "Modifica barca" };

export default page(async function EditBoatPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const [boat] = await db
    .select()
    .from(boats)
    .where(and(eq(boats.id, id), eq(boats.marinaId, ctx.marinaId)))
    .limit(1);
  if (!boat) notFound();
  const ownerList = await db
    .select({ id: owners.id, name: owners.displayName })
    .from(owners)
    .where(and(eq(owners.marinaId, ctx.marinaId), sql`${owners.anonymizedAt} is null`))
    .orderBy(asc(owners.displayName));

  return (
    <>
      <PageHeader title={`Modifica ${boat.name}`} back={{ href: `/barche/${boat.id}`, label: boat.name }} />
      <BoatForm
        owners={ownerList}
        boat={{ ...boat, length: metersInput(boat.lengthCm), beam: metersInput(boat.beamCm), draft: metersInput(boat.draftCm), declaredValue: moneyInput(boat.declaredValueCents) }}
      />
    </>
  );
});
