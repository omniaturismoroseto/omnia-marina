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
import { historyState } from "@/server/settings-history";
import { SavedHistoryButtons } from "@/components/saved-history";
import { BoaterSettingsForm, ContractTextsForm, LegalTextsForm, MarinaForm } from "./settings-forms";
import { SettingsTabs } from "./tabs";

export const metadata: Metadata = { title: "Impostazioni" };

export default page(async function SettingsPage() {
  const ctx = await requireMarina(["admin"]);
  const [marina] = await db.select().from(marinas).where(eq(marinas.id, ctx.marinaId));
  const logo = portLogo(marina);
  const [bulletin, history] = await Promise.all([latestCivilBulletin(), historyState(ctx.marinaId, "porto", [ctx.marinaId])]);
  const saved = history[ctx.marinaId];
  const zones = bulletin?.days[0]?.zones ?? [];

  return (
    <>
      <PageHeader help="impostazioni" title="Impostazioni" description="Dati del porto, struttura dei pontili, categorie e persone che vi lavorano." />
      <SettingsTabs current="porto" />
      <div className="mb-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
        <p className="text-sm text-muted">Modifiche salvate in questa pagina:</p>
        <SavedHistoryButtons area="porto" targetId={ctx.marinaId} undo={saved.undo} redo={saved.redo} />
      </div>
      {/* Dopo «Indietro» o «Avanti» i moduli ripartono dai valori salvati. */}
      <div className="space-y-5" key={saved.version}>
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
        <Card title="Testo del contratto">
          <p className="mb-4 max-w-3xl text-sm text-muted">
            Le parti fisse del contratto stampato: titolo, apertura, dati del porto, testi degli articoli 1-3 e firme. Scrivile come servono al
            tuo porto; i dati di ogni contratto (cliente, barca, posto, date, importi e scadenze) li aggiunge l&apos;app. Le condizioni
            dall&apos;articolo 4 e l&apos;approvazione specifica sono qui sotto. Per vedere il risultato apri la stampa di un contratto.
          </p>
          <ContractTextsForm texts={marina.contractTexts ?? {}} summary={marina.contractSummary} />
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
