import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berthCategories, berths, piers } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { formatDimensions, metersInput } from "@/lib/format";
import { uuidOrNull } from "@/lib/params";
import { BerthForm, DeleteBerthButton } from "../../../settings-forms";

export const metadata: Metadata = { title: "Posto barca" };

export default page(async function BerthPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(["admin"]);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const [row] = await db
    .select({ berth: berths, pierName: piers.name })
    .from(berths)
    .innerJoin(piers, eq(piers.id, berths.pierId))
    .where(and(eq(berths.id, id), eq(berths.marinaId, ctx.marinaId)))
    .limit(1);
  if (!row) notFound();
  const { berth } = row;
  const categories = await db
    .select()
    .from(berthCategories)
    .where(eq(berthCategories.marinaId, ctx.marinaId))
    .orderBy(asc(berthCategories.sortOrder), asc(berthCategories.maxLengthCm));

  return (
    <>
      <PageHeader title={`Posto ${berth.code}`} description={row.pierName} back={{ href: "/impostazioni/pontili", label: "Pontili e posti" }} />
      <BerthForm
        berth={{ ...berth, length: metersInput(berth.lengthCm), beam: metersInput(berth.beamCm), draft: metersInput(berth.draftCm) }}
        categories={categories.map((c) => ({ id: c.id, label: `${c.name} (${formatDimensions(c.maxLengthCm, c.maxBeamCm)})` }))}
      />
      <div className="mt-5">
        <DeleteBerthButton berthId={berth.id} />
      </div>
    </>
  );
});
