import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { page } from "@/components/page";
import { Card, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { LegalTextsForm, MarinaForm } from "./settings-forms";
import { SettingsTabs } from "./tabs";

export const metadata: Metadata = { title: "Impostazioni" };

export default page(async function SettingsPage() {
  const ctx = await requireMarina(["admin"]);
  const [marina] = await db.select().from(marinas).where(eq(marinas.id, ctx.marinaId));

  return (
    <>
      <PageHeader title="Impostazioni" description="Dati del porto, struttura dei pontili, categorie e persone che vi lavorano." />
      <SettingsTabs current="porto" />
      <div className="space-y-5">
        <Card title="Dati del porto">
          <MarinaForm marina={marina} />
        </Card>
        <Card title="Privacy e condizioni di contratto">
          <div className="mb-4">
            <Notice tone="sea">
              I testi precompilati sono modelli di partenza: falli verificare dal tuo consulente legale o privacy prima di usarli con i clienti.
            </Notice>
          </div>
          <LegalTextsForm version={marina.privacyPolicyVersion} privacyText={marina.privacyPolicyText ?? ""} contractTerms={marina.contractTerms ?? ""} />
        </Card>
      </div>
    </>
  );
});
