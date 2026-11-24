import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { Card, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import {
  berthCategories,
  berths,
  marinaPlanBases,
  marinaPlans,
  marinas,
  pierSections,
  piers,
  planFeatures,
} from "@/db/schema";
import { berthSizePx } from "@/lib/plan";
import { buildDrawing } from "@/lib/plan-drawing";
import { planUnits, traceFromColumns, unitPositions } from "@/lib/plan-units";
import { requireMarina } from "@/lib/context";
import { SettingsTabs } from "../tabs";
import type { StoredAnalysis } from "@/lib/plan-analysis";
import { planAnalysisAvailable } from "@/server/plan-ai";
import { AutoDetect } from "./auto-detect";
import { BaseUploader } from "./base-uploader";
import { PhotoUploader } from "./photo-uploader";
import { PlanEditor } from "./plan-editor";
import { PlanSection, PlanSections } from "./plan-sections";
import { one, uuidOrNull, type SearchParams } from "@/lib/params";
import { SurroundingsEditor, type BerthRect } from "./surroundings-editor";
import { byBerthCode } from "@/server/berth-order";

export const metadata: Metadata = { title: "Mappa del porto" };

export default page(async function PlanSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const ctx = await requireMarina(["admin"]);
  const [[marina], pierRows, berthRows, sectionRows] = await Promise.all([
    db
      .select({
        width: marinas.planWidth,
        height: marinas.planHeight,
        pxPerMeter: marinas.planPxPerMeter,
        version: marinas.planVersion,
      })
      .from(marinas)
      .where(eq(marinas.id, ctx.marinaId)),
    db
      .select({
        id: piers.id,
        name: piers.name,
        code: piers.code,
        ax: piers.planAx,
        ay: piers.planAy,
        bx: piers.planBx,
        by: piers.planBy,
        widthM: piers.planWidthM,
      })
      .from(piers)
      .where(eq(piers.marinaId, ctx.marinaId))
      .orderBy(asc(piers.sortOrder), asc(piers.code)),
    db
      .select({
        id: berths.id,
        code: berths.code,
        pierId: berths.pierId,
        sectionId: berths.sectionId,
        side: berths.side,
        position: berths.position,
        lengthCm: berths.lengthCm,
        beamCm: berths.beamCm,
        x: berths.planX,
        y: berths.planY,
        angle: berths.planAngle,
        module: berths.planModule,
      })
      .from(berths)
      .where(eq(berths.marinaId, ctx.marinaId))
      .orderBy(...byBerthCode),
    db
      .select()
      .from(pierSections)
      .where(eq(pierSections.marinaId, ctx.marinaId))
      .orderBy(asc(pierSections.sortOrder)),
  ]);
  // Strutture della pianta: i pontili, e per quelli uniti un tratto per ogni pontile di prima.
  const units = planUnits(
    pierRows.map((p) => ({
      id: p.id,
      name: p.name,
      trace: traceFromColumns({ planAx: p.ax, planAy: p.ay, planBx: p.bx, planBy: p.by, planWidthM: p.widthM }),
      sections: sectionRows
        .filter((sec) => sec.pierId === p.id)
        .map((sec) => ({ id: sec.id, label: sec.label, trace: traceFromColumns(sec) })),
    })),
    berthRows,
  );
  // Per l'editor ogni struttura è un «pontile»: posti con l'id della struttura e posizioni contate dalla sua radice.
  const editorPiers = units.map((unit) => ({
    id: unit.id,
    name: unit.name,
    ax: unit.trace?.a.x ?? null,
    ay: unit.trace?.a.y ?? null,
    bx: unit.trace?.b.x ?? null,
    by: unit.trace?.b.y ?? null,
    widthM: unit.trace?.widthM ?? null,
  }));
  const editorBerths = units.flatMap((unit) => {
    const positions = unitPositions(unit.berths);
    return unit.berths.map(({ sectionId: _section, ...b }) => ({ ...b, pierId: unit.id, realPierId: b.pierId, position: positions.get(b.id) ?? b.position }));
  });
  const [[plan], categories, featureRows, [base]] = await Promise.all([
    db
      .select({ analysis: marinaPlans.analysis })
      .from(marinaPlans)
      .where(eq(marinaPlans.marinaId, ctx.marinaId)),
    db
      .select({
        id: berthCategories.id,
        name: berthCategories.name,
        maxLengthCm: berthCategories.maxLengthCm,
        maxBeamCm: berthCategories.maxBeamCm,
      })
      .from(berthCategories)
      .where(eq(berthCategories.marinaId, ctx.marinaId))
      .orderBy(
        asc(berthCategories.sortOrder),
        asc(berthCategories.maxLengthCm),
      ),
    db
      .select({
        id: planFeatures.id,
        kind: planFeatures.kind,
        service: planFeatures.service,
        name: planFeatures.name,
        points: planFeatures.points,
        source: planFeatures.source,
      })
      .from(planFeatures)
      .where(eq(planFeatures.marinaId, ctx.marinaId))
      .orderBy(asc(planFeatures.sortOrder)),
    db
      .select({ updatedAt: marinaPlanBases.updatedAt })
      .from(marinaPlanBases)
      .where(eq(marinaPlanBases.marinaId, ctx.marinaId)),
  ]);
  const baseUrl = base ? `/pianta/base?v=${base.updatedAt.getTime()}` : null;
  const hasPhoto = marina.width !== null && marina.height !== null;
  // Le proposte valgono solo per la foto su cui sono state calcolate.
  const stored = (plan?.analysis ?? null) as StoredAnalysis | null;
  const analysis =
    stored &&
    stored.photoVersion === marina.version &&
    Array.isArray(stored.proposals)
      ? stored
      : null;
  const placedBerths = berthRows.flatMap((b) =>
    b.x !== null && b.y !== null
      ? [
          {
            x: b.x,
            y: b.y,
            angle: b.angle ?? 0,
            lengthCm: b.lengthCm,
            beamCm: b.beamCm,
          },
        ]
      : [],
  );
  const placedCount = berthRows.filter((b) => b.x !== null).length;

  // Per ricavare terra e acqua dai colori: i posti (che contano come acqua) e un punto in acqua davanti alla prua di ciascuno.
  const scale = marina.pxPerMeter;
  const berthRects: BerthRect[] = scale
    ? berthRows.flatMap((b) =>
        b.x !== null && b.y !== null
          ? [{ x: b.x, y: b.y, angle: b.angle ?? 0, ...berthSizePx(b, scale) }]
          : [],
      )
    : [];
  const drawing = scale
    ? buildDrawing(
        units.map((unit) => ({
          id: unit.id,
          name: unit.pierName,
          trace: unit.trace,
          berths: unit.berths.flatMap((b) =>
            b.x !== null && b.y !== null
              ? [
                  {
                    id: b.id,
                    side: b.side,
                    x: b.x,
                    y: b.y,
                    angle: b.angle ?? 0,
                    lengthCm: b.lengthCm,
                    beamCm: b.beamCm,
                  },
                ]
              : [],
          ),
        })),
        scale,
      )
    : null;
  const waterSeeds = drawing
    ? berthRows.flatMap((b) => {
        if (b.x === null || b.y === null) return [];
        const a = ((b.angle ?? 0) * Math.PI) / 180;
        const stern = drawing.stern.get(b.id) ?? 1;
        // Dalla poppa verso la prua, 2 m oltre la fine del posto.
        const reach = (b.lengthCm / 200 + 2) * scale!;
        return [
          {
            x: b.x + Math.sin(a) * stern * reach,
            y: b.y - Math.cos(a) * stern * reach,
          },
        ];
      })
    : [];

  return (
    <>
      <PageHeader
        help="impostazioni"
        title="Impostazioni"
        description="La mappa può mostrare i posti barca sopra una foto aerea del porto, nelle posizioni e nelle misure reali."
      />
      <SettingsTabs current="pianta" />

      <PlanSections initial={one(params.parte) || (hasPhoto ? "posti" : "foto")}>
        {hasPhoto && (
          <PlanSection id="posti" label="Posti sulla foto">
          {/* data-wide: come la Mappa, l'editor usa tutta la larghezza dello schermo (vedi il layout). */}
          <div id="editor" data-wide className="scroll-mt-4">
          <Card title="Disponi i posti sulla foto">
            <ol className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
              <li>
                <strong className="font-medium text-ink">1.</strong> Imposta la
                scala
              </li>
              <li>
                <strong className="font-medium text-ink">2.</strong> Traccia
                ogni pontile: i suoi posti si dispongono da soli
              </li>
              <li>
                <strong className="font-medium text-ink">3.</strong> Ritocca
                dove serve e salva
              </li>
            </ol>
            {berthRows.length === 0 && (
              <div className="mb-4">
                <Notice>
                  Il porto non ha ancora posti barca: puoi già impostare la
                  scala e salvarla. Per disporre i posti, creali prima in{" "}
                  <Link href="/impostazioni/pontili" className="link">
                    Pontili e posti
                  </Link>
                  .
                </Notice>
              </div>
            )}
            {/* key: una nuova foto, posti nuovi (per esempio creati dalle proposte, che fissano anche la scala) o un tratto nuovo fanno ripartire
                l'editor dai dati aggiornati; i salvataggi fatti dall'editor stesso no, così il suo messaggio resta visibile. */}
            <PlanEditor
              key={`${marina.version}:${berthRows.length}:${sectionRows.map((sec) => sec.id).join(",")}`}
              imageUrl={`/pianta/immagine?v=${marina.version}`}
              baseUrl={baseUrl}
              width={marina.width!}
              height={marina.height!}
              initialPxPerMeter={marina.pxPerMeter}
              piers={editorPiers}
              initialBerths={editorBerths}
              initialPierId={uuidOrNull(one(params.struttura)) ?? undefined}
              categories={categories}
              usedCodes={pierRows.map((p) => p.code)}
            />
          </Card>
          </div>
          </PlanSection>
        )}
        <PlanSection id="foto" label="Foto aerea">
        <Card title="Foto aerea del porto">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="max-w-2xl space-y-2 text-sm text-muted">
              <p>
                Va bene un&apos;immagine salvata da Google Earth,
                un&apos;ortofoto del geoportale regionale, una foto da drone o
                la planimetria del progetto: l&apos;importante è che sia{" "}
                <strong className="font-medium text-ink">
                  ripresa dall&apos;alto, non inclinata
                </strong>
                , e che inquadri tutti i pontili.
              </p>
              <p>
                Con Google Earth Pro: inquadra il porto, premi{" "}
                <kbd className="rounded border border-line bg-white px-1 text-ink">
                  R
                </kbd>{" "}
                per la vista dall&apos;alto con il nord in alto, poi File →
                Salva → Salva immagine. Con il righello misura la lunghezza di
                un pontile: ti servirà per impostare la scala.
              </p>
              <p className="text-xs">
                Rispetta le condizioni d&apos;uso della fonte: per le immagini
                di Google Earth va mantenuta visibile l&apos;attribuzione.
              </p>
            </div>
            <PhotoUploader hasPhoto={hasPhoto} placedCount={placedCount} />
          </div>
        </Card>
        </PlanSection>
        {hasPhoto && (
          <PlanSection id="riconoscimento" label="Riconoscimento automatico">
          <Card
            title={
              analysis ? "Proposte dalla foto" : "Riconoscimento automatico"
            }
          >
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
          </PlanSection>
        )}
        {hasPhoto && (
          <PlanSection id="sfondo" label="Sfondo e servizi">
          <Card title="Sfondo e servizi della mappa">
            <p className="mb-4 max-w-3xl text-sm text-muted">
              Lo schema della mappa disegna il porto come una mappa illustrata:
              terra, moli ed edifici in grigio, aree verdi e i servizi (bar,
              ristorante, parcheggio, cantiere, carburante…). Ricava terra e
              acqua dai colori della foto, chiedi a Claude edifici e servizi,
              poi ritocca a mano e salva.
            </p>
            <SurroundingsEditor
              key={`${marina.version}:${baseUrl ?? ""}`}
              imageUrl={`/pianta/immagine?v=${marina.version}`}
              width={marina.width!}
              height={marina.height!}
              pxPerMeter={marina.pxPerMeter}
              initialFeatures={featureRows}
              berthRects={berthRects}
              waterSeeds={waterSeeds}
              aiAvailable={planAnalysisAvailable()}
              baseUrl={baseUrl}
            />
          </Card>
          </PlanSection>
        )}
        {hasPhoto && (
          <PlanSection id="base" label="Base disegnata">
          <Card title="Base disegnata della mappa">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="max-w-2xl space-y-2 text-sm text-muted">
                <p>
                  Per uno schema da mappa illustrata si può far disegnare la
                  base (terra, moli, pontili, edifici, verde, rosa dei venti) a
                  un grafico, ricalcando questa foto aerea. Nella base{" "}
                  <strong className="font-medium text-ink">non vanno</strong>{" "}
                  barche, nomi dei pontili e servizi: li aggiunge l&apos;app,
                  così restano sempre aggiornati e la direzione può cambiarli.
                </p>
                <p>
                  Va esportata in PNG con{" "}
                  <strong className="font-medium text-ink">
                    la stessa inquadratura della foto
                  </strong>
                  {` (${marina.width} × ${marina.height} pixel o un multiplo, per esempio il doppio)`}
                  , senza ritagliare: così i posti già disposti cadono al loro
                  posto.
                </p>
              </div>
              <BaseUploader hasBase={Boolean(base)} />
            </div>
            {baseUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- immagine servita dall'app, già alla misura giusta
              <img
                src={baseUrl}
                alt="Base disegnata caricata"
                className="mt-4 max-h-72 w-auto rounded-md border border-line"
              />
            )}
          </Card>
          </PlanSection>
        )}
      </PlanSections>
    </>
  );
});
