import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { page } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { OwnerForm } from "../owner-form";

export const metadata: Metadata = { title: "Nuovo cliente" };

export default page(async function NewOwnerPage() {
  const ctx = await requireMarina(OFFICE);
  const [marina] = await db.select({ version: marinas.privacyPolicyVersion }).from(marinas).where(eq(marinas.id, ctx.marinaId));
  return (
    <>
      <PageHeader title="Nuovo cliente" back={{ href: "/clienti", label: "Clienti" }} />
      <OwnerForm policyVersion={marina.version} />
    </>
  );
});
