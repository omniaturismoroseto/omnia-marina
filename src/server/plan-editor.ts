import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { berthCategories, berths, marinaPlanBases, marinas, pierSections, piers, planFeatures } from "@/db/schema";
import { drawingOrder } from "@/lib/plan-features";
import { planUnits, traceFromColumns, unitPositions } from "@/lib/plan-units";
import { byBerthCode } from "./berth-order";

/**
 * Dati dell'editor dei posti sulla pianta (Impostazioni → Mappa del porto, e sotto la scheda del pontile in Pontili e posti).
 * Null se il porto non ha ancora la foto. Per l'editor ogni struttura è un «pontile»: il pontile o, nei pontili uniti, il tratto,
 * con le posizioni contate dalla sua radice.
 */
export async function loadPlanEditor(marinaId: string) {
  const [[marina], pierRows, berthRows, sectionRows, categories, featureRows, [base]] = await Promise.all([
    db
      .select({ width: marinas.planWidth, height: marinas.planHeight, pxPerMeter: marinas.planPxPerMeter, version: marinas.planVersion })
      .from(marinas)
      .where(eq(marinas.id, marinaId)),
    db
      .select({ id: piers.id, name: piers.name, code: piers.code, ax: piers.planAx, ay: piers.planAy, bx: piers.planBx, by: piers.planBy, widthM: piers.planWidthM })
      .from(piers)
      .where(eq(piers.marinaId, marinaId))
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
      .where(eq(berths.marinaId, marinaId))
      .orderBy(...byBerthCode),
    db.select().from(pierSections).where(eq(pierSections.marinaId, marinaId)).orderBy(asc(pierSections.sortOrder)),
    db
      .select({ id: berthCategories.id, name: berthCategories.name, maxLengthCm: berthCategories.maxLengthCm, maxBeamCm: berthCategories.maxBeamCm })
      .from(berthCategories)
      .where(eq(berthCategories.marinaId, marinaId))
      .orderBy(asc(berthCategories.sortOrder), asc(berthCategories.maxLengthCm)),
    db
      .select({ id: planFeatures.id, kind: planFeatures.kind, service: planFeatures.service, name: planFeatures.name, points: planFeatures.points, source: planFeatures.source })
      .from(planFeatures)
      .where(eq(planFeatures.marinaId, marinaId))
      .orderBy(asc(planFeatures.sortOrder)),
    db.select({ updatedAt: marinaPlanBases.updatedAt }).from(marinaPlanBases).where(eq(marinaPlanBases.marinaId, marinaId)),
  ]);
  if (!marina || marina.width === null || marina.height === null) return null;

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

  return {
    // Una nuova foto, posti nuovi, un tratto nuovo o posti cambiati da fuori dall'editor (es. «Numerazione» in Pontili e posti)
    // fanno ripartire l'editor dai dati aggiornati (vedi `key`): così un salvataggio non rimette le posizioni vecchie.
    key: `${marina.version}:${berthRows.length}:${sectionRows.map((sec) => sec.id).join(",")}:${layoutStamp(berthRows)}`,
    imageUrl: `/pianta/immagine?v=${marina.version}`,
    baseUrl: base ? `/pianta/base?v=${base.updatedAt.getTime()}` : null,
    width: marina.width,
    height: marina.height,
    initialPxPerMeter: marina.pxPerMeter,
    piers: editorPiers,
    initialBerths: editorBerths,
    categories,
    usedCodes: pierRows.map((p) => p.code),
    features: drawingOrder(featureRows),
  };
}

// Impronta di posizioni, lati e moduli dei posti: cambia quando cambia la loro disposizione.
function layoutStamp(rows: { side: string; position: number; x: number | null; y: number | null; angle: number | null; module: number | null }[]): string {
  let h = 0;
  for (const r of rows) {
    const text = `${r.side}${r.position}|${r.x ?? ""}|${r.y ?? ""}|${r.angle ?? ""}|${r.module ?? ""};`;
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export type PlanEditorData = NonNullable<Awaited<ReturnType<typeof loadPlanEditor>>>;
