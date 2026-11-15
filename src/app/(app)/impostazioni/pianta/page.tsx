import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { Card, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berthCategories, berths, marinaPlans, marinas, piers } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { SettingsTabs } from "../tabs";
import type { StoredAnalysis } from "@/lib/plan-analysis";
import { planAnalysisAvailable } from "@/server/plan-ai";
import { AutoDetect } from "./auto-detect";
import { PhotoUploader } from "./photo-uploader";
import { PlanEditor } from "./plan-editor";

export const metadata: Metadata = { title: "Pianta dal vero" };

export default page(async function PlanSettingsPage() {
  const ctx = await requireMarina(["admin"]);
  const [[marina], pierRows, berthRows] = await Promise.all([
    db
      .select({ width: marinas.planWidth, height: marinas.planHeight, pxPerMeter: marinas.planPxPerMeter, version: marinas.planVersion })
      .from(marinas)
      .where(eq(marinas.id, ctx.marinaId)),
    db.select({ id: piers.id, name: piers.name, code: piers.code }).from(piers).where(eq(piers.marinaId, ctx.marinaId)).orderBy(asc(piers.sortOrder), asc(piers.code)),
    db
      .select({
        id: berths.id,
        code: berths.code,
        pierId: berths.pierId,
        side: berths.side,
        position: berths.position,
        lengthCm: berths.lengthCm,
        beamCm: berths.beamCm,
        x: berths.planX,
        y: berths.planY,
        angle: berths.planAngle,
      })
      .from(berths)
      .where(eq(berths.marinaId, ctx.marinaId))
      .orderBy(asc(berths.code)),
  ]);
  const [[plan], categories] = await Promise.all([
    db.select({ analysis: marinaPlans.analysis }).from(marinaPlans).where(eq(marinaPlans.marinaId, ctx.marinaId)),
    db
      .select({ id: berthCategories.id, name: berthCategories.name, maxLengthCm: berthCategories.maxLengthCm, maxBeamCm: berthCategories.maxBeamCm })
      .from(berthCategories)
      .where(eq(berthCategories.marinaId, ctx.marinaId))
      .orderBy(asc(berthCategories.sortOrder), asc(berthCategories.maxLengthCm)),
  ]);
  const hasPhoto = marina.width !== null && marina.height !== null;
  // Le proposte valgono solo per la foto su cui sono state calcolate.
  const stored = (plan?.analysis ?? null) as StoredAnalysis | null;
  const analysis = stored && stored.photoVersion === marina.version && Array.isArray(stored.proposals) ? stored : null;
  const placedBerths = berthRows.flatMap((b) =>
    b.x !== null && b.y !== null ? [{ x: b.x, y: b.y, angle: b.angle ?? 0, lengthCm: b.lengthCm, beamCm: b.beamCm }] : [],
  );
  const placedCount = berthRows.filter((b) => b.x !== null).length;

  return (
    <>
      <PageHeader title="Impostazioni" description="La mappa può mostrare i posti barca sopra una foto aerea del porto, nelle posizioni e nelle misure reali." />
      <SettingsTabs current="pianta" />

      <div className="space-y-5">
        <Card title="Foto aerea del porto">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="max-w-2xl space-y-2 text-sm text-muted">
              <p>
                Va bene un&apos;immagine salvata da Google Earth, un&apos;ortofoto del geoportale regionale, una foto da drone o la planimetria del progetto: l&apos;importante è che sia{" "}
                <strong className="font-medium text-ink">ripresa dall&apos;alto, non inclinata</strong>, e che inquadri tutti i pontili.
              </p>
              <p>
                Con Google Earth Pro: inquadra il porto, premi <kbd className="rounded border border-line bg-white px-1 text-ink">R</kbd> per la vista dall&apos;alto con il nord in alto, poi File → Salva → Salva immagine. Con il
                righello misura la lunghezza di un pontile: ti servirà per impostare la scala.
              </p>
              <p className="text-xs">Rispetta le condizioni d&apos;uso della fonte: per le immagini di Google Earth va mantenuta visibile l&apos;attribuzione.</p>
            </div>
            <PhotoUploader hasPhoto={hasPhoto} placedCount={placedCount} />
          </div>
        </Card>

        {hasPhoto && (
          <Card title={analysis ? "Proposte dalla foto" : "Riconoscimento automatico"}>
            <AutoDetect
              available={planAnalysisAvailable()}
              analysis={analysis}
              imageUrl={`/pianta/immagine?v=${marina.version}`}
              width={marina.width!}
              height={marina.height!}
              pxPerMeter={marina.pxPerMeter}
              categories={categories}
              usedCodes={pierRows.map((p) => p.code)}
              placed={placedBerths}
            />
          </Card>
        )}

        {hasPhoto && (
          <Card title="Disponi i posti sulla foto">
            <ol className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
              <li>
                <strong className="font-medium text-ink">1.</strong> Imposta la scala
              </li>
              <li>
                <strong className="font-medium text-ink">2.</strong> Traccia ogni pontile: i suoi posti si dispongono da soli
              </li>
              <li>
                <strong className="font-medium text-ink">3.</strong> Ritocca dove serve e salva
              </li>
            </ol>
            {berthRows.length === 0 && (
              <div className="mb-4">
                <Notice>
                  Il porto non ha ancora posti barca: puoi già impostare la scala e salvarla. Per disporre i posti, creali prima in{" "}
                  <Link href="/impostazioni/pontili" className="link">
                    Pontili e posti
                  </Link>
                  .
                </Notice>
              </div>
            )}
            {/* key: una nuova foto o posti nuovi (per esempio creati dalle proposte, che fissano anche la scala) fanno ripartire
                l'editor dai dati aggiornati; i salvataggi fatti dall'editor stesso no, così il suo messaggio resta visibile. */}
            <PlanEditor
              key={`${marina.version}:${berthRows.length}`}
              imageUrl={`/pianta/immagine?v=${marina.version}`}
              width={marina.width!}
              height={marina.height!}
              initialPxPerMeter={marina.pxPerMeter}
              piers={pierRows}
              initialBerths={berthRows}
            />
          </Card>
        )}
      </div>
    </>
  );
});
