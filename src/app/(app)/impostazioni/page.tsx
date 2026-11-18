import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { page } from "@/components/page";
import { PortLogo } from "@/components/port-logo";
import { Card, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { portLogo } from "@/lib/logo";
import { LogoUploader } from "./logo-uploader";
import { findZoneByComune } from "@/lib/civil-protection";
import { formatCoordinates } from "@/lib/weather";
import { latestCivilBulletin } from "@/server/civil-protection";
import { weatherEnabled } from "@/server/weather";
import { BoaterSettingsForm, LegalTextsForm, MarinaForm } from "./settings-forms";
import { SettingsTabs } from "./tabs";

export const metadata: Metadata = { title: "Impostazioni" };

export default page(async function SettingsPage() {
  const ctx = await requireMarina(["admin"]);
  const [marina] = await db.select().from(marinas).where(eq(marinas.id, ctx.marinaId));
  const logo = portLogo(marina);
  const bulletin = await latestCivilBulletin();
  const zones = bulletin?.days[0]?.zones ?? [];

  return (
    <>
      <PageHeader help="impostazioni" title="Impostazioni" description="Dati del porto, struttura dei pontili, categorie e persone che vi lavorano." />
      <SettingsTabs current="porto" />
      <div className="space-y-5">
        <Card title="Dati del porto">
          <MarinaForm marina={marina} />
        </Card>
        <Card title="Logo della società di gestione">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex h-28 w-full shrink-0 items-center justify-center rounded-md border border-dashed border-line bg-white p-3 sm:w-56">
              {logo ? (
                <PortLogo logo={logo} alt={`Logo di ${marina.legalName || marina.name}`} className="max-h-full w-auto max-w-full" />
              ) : (
                <span className="text-sm text-faint">Nessun logo</span>
              )}
            </div>
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Compare nel menu dell&apos;app accanto al nome del porto e in testa al contratto e all&apos;informativa privacy stampati. Usa un PNG con
                sfondo trasparente (oppure un JPEG): i margini vuoti si tolgono da soli e l&apos;immagine viene ridotta alla misura giusta.
              </p>
              <LogoUploader hasLogo={logo !== null} />
            </div>
          </div>
        </Card>
        <Card title="Area diportisti e allerte">
          <BoaterSettingsForm
            officeHours={marina.officeHours ?? ""}
            boaterInfo={marina.boaterInfo ?? ""}
            coordinates={formatCoordinates(marina.latitude, marina.longitude)}
            windAlertKnots={marina.windAlertKnots}
            waveAlertM={marina.waveAlertM}
            windAlertAuto={marina.windAlertAuto}
            alertZone={marina.alertZone ?? ""}
            zoneNames={[...new Set(zones.map((z) => z.name))].sort((a, b) => a.localeCompare(b, "it"))}
            detectedZone={findZoneByComune(zones, marina.city)?.name ?? null}
            forecastEnabled={weatherEnabled()}
          />
        </Card>
        <Card title="Privacy e condizioni di contratto">
          <div className="mb-4">
            <Notice tone="sea">
              I testi precompilati sono modelli di partenza: falli verificare dal tuo consulente legale o privacy prima di usarli con i clienti.
            </Notice>
          </div>
          <LegalTextsForm
            version={marina.privacyPolicyVersion}
            privacyText={marina.privacyPolicyText ?? ""}
            contractTerms={marina.contractTerms ?? ""}
            contractApprovalText={marina.contractApprovalText ?? ""}
          />
        </Card>
      </div>
    </>
  );
});
