import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { berths, marinaPlanBases, marinas, parkingSpaces, pierSections, piers, planFeatures } from "@/db/schema";
import type { DrawingPier } from "@/lib/plan-drawing";
import { drawingOrder, type PlanFeature } from "@/lib/plan-features";
import { planUnits, traceFromColumns } from "@/lib/plan-units";

/** Posto barca disposto sulla pianta, come serve a disegnarlo. */
export interface PlanMapBerth {
  id: string;
  code: string;
  planX: number;
  planY: number;
  planAngle: number | null;
  lengthCm: number;
  beamCm: number;
}

/**
 * Tutto ciò che serve a disegnare lo schema del porto fuori dalla pagina Mappa (es. per scegliere un posto in un contratto):
 * dimensioni e scala della pianta, sfondo, pontili con i loro posti. Null se la pianta non è ancora pronta.
 */
export interface PlanMapData {
  width: number;
  height: number;
  pxPerMeter: number;
  baseUrl: string | null;
  features: PlanFeature[];
  piers: DrawingPier[];
  berths: PlanMapBerth[];
  /** Posti auto messi sulla mappa (Impostazioni → Posti auto). */
  parking: PlanMapParking[];
}

/** Posto auto disposto sulla mappa. */
export interface PlanMapParking {
  id: string;
  code: string;
  covered: boolean;
  active: boolean;
  x: number;
  y: number;
  angle: number;
  lengthCm: number;
  widthCm: number;
}

export async function loadPlanMap(marinaId: string): Promise<PlanMapData | null> {
  const [[plan], pierRows, sectionRows, berthRows, featureRows, [base], parkingRows] = await Promise.all([
    db.select({ width: marinas.planWidth, height: marinas.planHeight, pxPerMeter: marinas.planPxPerMeter }).from(marinas).where(eq(marinas.id, marinaId)),
    db.select().from(piers).where(eq(piers.marinaId, marinaId)).orderBy(asc(piers.sortOrder), asc(piers.code)),
    db.select().from(pierSections).where(eq(pierSections.marinaId, marinaId)).orderBy(asc(pierSections.sortOrder)),
    db
      .select({
        id: berths.id,
        code: berths.code,
        pierId: berths.pierId,
        sectionId: berths.sectionId,
        side: berths.side,
        planX: berths.planX,
        planY: berths.planY,
        planAngle: berths.planAngle,
        lengthCm: berths.lengthCm,
        beamCm: berths.beamCm,
      })
      .from(berths)
      .where(eq(berths.marinaId, marinaId)),
    db
      .select({ id: planFeatures.id, kind: planFeatures.kind, service: planFeatures.service, name: planFeatures.name, points: planFeatures.points, source: planFeatures.source })
      .from(planFeatures)
      .where(eq(planFeatures.marinaId, marinaId))
      .orderBy(asc(planFeatures.sortOrder)),
    db.select({ updatedAt: marinaPlanBases.updatedAt }).from(marinaPlanBases).where(eq(marinaPlanBases.marinaId, marinaId)),
    db.select().from(parkingSpaces).where(eq(parkingSpaces.marinaId, marinaId)),
  ]);
  if (!plan || plan.width === null || plan.height === null || plan.pxPerMeter === null) return null;
  const placed = berthRows.flatMap((b) => (b.planX === null || b.planY === null ? [] : [{ ...b, planX: b.planX, planY: b.planY }]));
  if (placed.length === 0) return null;

  return {
    width: plan.width,
    height: plan.height,
    pxPerMeter: plan.pxPerMeter,
    baseUrl: base ? `/pianta/base?v=${base.updatedAt.getTime()}` : null,
    features: drawingOrder(featureRows),
    // Una striscia per pontile, o per tratto nei pontili uniti.
    piers: planUnits(
      pierRows.map((p) => ({
        id: p.id,
        name: p.name,
        trace: traceFromColumns(p),
        sections: sectionRows.filter((sec) => sec.pierId === p.id).map((sec) => ({ id: sec.id, label: sec.label, trace: traceFromColumns(sec) })),
      })),
      placed,
    ).map((unit) => ({
      id: unit.id,
      name: unit.pierName,
      trace: unit.trace,
      berths: unit.berths.map((b) => ({ id: b.id, side: b.side, x: b.planX, y: b.planY, angle: b.planAngle ?? 0, lengthCm: b.lengthCm, beamCm: b.beamCm })),
    })),
    berths: placed.map(({ id, code, planX, planY, planAngle, lengthCm, beamCm }) => ({ id, code, planX, planY, planAngle, lengthCm, beamCm })),
    parking: parkingRows.flatMap((r) =>
      r.planX !== null && r.planY !== null
        ? [{ id: r.id, code: r.code, covered: r.covered, active: r.active, x: r.planX, y: r.planY, angle: r.planAngle ?? 0, lengthCm: r.lengthCm, widthCm: r.widthCm }]
        : [],
    ),
  };
}
