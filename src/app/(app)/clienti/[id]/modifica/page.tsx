import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { page } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { marinas, owners } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { uuidOrNull } from "@/lib/params";
import { OwnerForm } from "../../owner-form";

export const metadata: Metadata = { title: "Modifica cliente" };

export default page(async function EditOwnerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const [owner] = await db
    .select()
    .from(owners)
    .where(and(eq(owners.id, id), eq(owners.marinaId, ctx.marinaId), sql`${owners.anonymizedAt} is null`))
    .limit(1);
  if (!owner) notFound();
  const [marina] = await db.select({ version: marinas.privacyPolicyVersion }).from(marinas).where(eq(marinas.id, ctx.marinaId));

  return (
    <>
      <PageHeader title={`Modifica ${owner.displayName}`} back={{ href: `/clienti/${owner.id}`, label: owner.displayName }} />
      <OwnerForm owner={owner} policyVersion={marina.version} />
    </>
  );
});
