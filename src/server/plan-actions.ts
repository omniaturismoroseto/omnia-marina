"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, berthCategories, berths, marinaPlans, marinas, pierSections, piers, planFeatures } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMarina } from "@/lib/context";
import { pierGroupKey } from "@/lib/pricing";
import { estimateScale, MAX_BERTHS_PER_SIDE, planBerths, structureWidthM, toProposals, type StoredAnalysis } from "@/lib/plan-analysis";
import { surroundingsToFeatures, type PlanFeature } from "@/lib/plan-features";
import { isServiceKey } from "@/lib/port-services";
import { analyzePlanPhoto, analyzeSurroundingsPhoto, PlanAnalysisError, planAnalysisAvailable } from "./plan-ai";

const layoutSchema = z.object({
  pxPerMeter: z.number().positive().max(2000).nullable(),
  placements: z
    .array(
      z.object({
        id: z.uuid(),
        // null = posto tolto dalla pianta
        position: z.object({ x: z.number().finite(), y: z.number().finite(), angle: z.number().min(-360).max(360) }).nullable(),
      }),
    )
    .max(5000),
  // Linee dei pontili (o dei tratti dei pontili uniti: pierId è allora l'id del tratto) tracciate in questa sessione dell'editor.
  traces: z
    .array(
      z.object({
        pierId: z.uuid(),
        a: z.object({ x: z.number().finite(), y: z.number().finite() }),
        b: z.object({ x: z.number().finite(), y: z.number().finite() }),
        widthM: z.number().min(0).max(50),
      }),
    )
    .max(500)
    .default([]),
});

export type PlanLayoutInput = z.infer<typeof layoutSchema>;

// Salva la scala della foto e la posizione di tutti i posti disposti nell'editor della pianta.
export async function savePlanLayout(input: z.input<typeof layoutSchema>): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireMarina(["admin"]);
  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dati della pianta non validi." };
  const { pxPerMeter, placements, traces } = parsed.data;

  const [marina] = await db.select({ width: marinas.planWidth, height: marinas.planHeight }).from(marinas).where(eq(marinas.id, ctx.marinaId));
  if (!marina?.width || !marina.height) return { ok: false, message: "Carica prima la foto del porto." };

  // Un posto può sporgere un poco dal bordo della foto, ma non stare altrove.
  const margin = 0.1;
  const inside = (p: { x: number; y: number }) =>
    p.x >= -marina.width! * margin && p.x <= marina.width! * (1 + margin) && p.y >= -marina.height! * margin && p.y <= marina.height! * (1 + margin);
  if (placements.some((p) => p.position && !inside(p.position))) return { ok: false, message: "Alcuni posti sono fuori dalla foto." };
  if (traces.some((t) => !inside(t.a) || !inside(t.b))) return { ok: false, message: "Alcune linee dei pontili sono fuori dalla foto." };

  await db.transaction(async (tx) => {
    await tx.update(marinas).set({ planPxPerMeter: pxPerMeter }).where(eq(marinas.id, ctx.marinaId));
    if (placements.length > 0) {
      const rows = sql.join(
        placements.map((p) => sql`(${p.id}::uuid, ${p.position?.x ?? null}::real, ${p.position?.y ?? null}::real, ${p.position?.angle ?? null}::real)`),
        sql`, `,
      );
      // Il filtro sul porto garantisce che non si possano spostare posti di altri porti.
      await tx.execute(sql`
        update berths set plan_x = v.x, plan_y = v.y, plan_angle = v.angle
        from (values ${rows}) as v(id, x, y, angle)
        where berths.id = v.id and berths.marina_id = ${ctx.marinaId}
      `);
    }
    for (const t of traces) {
      // L'id è di un tratto di un pontile unito o di un pontile; il filtro sul porto impedisce di toccare quelli di altri porti.
      const line = { planAx: t.a.x, planAy: t.a.y, planBx: t.b.x, planBy: t.b.y, planWidthM: t.widthM };
      const section = await tx
        .update(pierSections)
        .set(line)
        .where(and(eq(pierSections.id, t.pierId), eq(pierSections.marinaId, ctx.marinaId)))
        .returning({ id: pierSections.id });
      if (section.length === 0) await tx.update(piers).set(line).where(and(eq(piers.id, t.pierId), eq(piers.marinaId, ctx.marinaId)));
    }
    const placed = placements.filter((p) => p.position).length;
    await audit(ctx, "modifica", "pianta del porto", ctx.marinaId, `${placed} posti disposti sulla foto`, tx);
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Pianta salvata." };
}

// ───────────────────────── Riconoscimento automatico ─────────────────────────

type Result = { ok: boolean; message: string };

// Ogni analisi ha un costo su Google: un tetto giornaliero per porto evita sorprese.
const DAILY_ANALYSES = 20;
const ANALYSIS_ACTION = "analisi automatica";
const LIMIT_MESSAGE = `Raggiunto il limite di ${DAILY_ANALYSES} analisi nelle ultime 24 ore. Riprova domani.`;

// Le analisi (pontili e sfondo) contano insieme: ognuna lascia una riga nel registro attività.
async function dailyLimitReached(marinaId: string): Promise<boolean> {
  const [{ recent }] = await db
    .select({ recent: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(eq(auditLog.marinaId, marinaId), eq(auditLog.action, ANALYSIS_ACTION), gt(auditLog.at, sql`now() - interval '24 hours'`)));
  return recent >= DAILY_ANALYSES;
}

/** Chiede a Claude di riconoscere pontili e banchine nella foto e salva le proposte, in attesa di conferma. */
export async function analyzePlan(): Promise<Result> {
  const ctx = await requireMarina(["admin"]);
  if (!planAnalysisAvailable()) {
    return { ok: false, message: "Il riconoscimento automatico non è ancora attivo: va abilitato una volta su Google Cloud (istruzioni in COME-LAVORIAMO.md)." };
  }

  if (await dailyLimitReached(ctx.marinaId)) return { ok: false, message: LIMIT_MESSAGE };

  const [row] = await db
    .select({
      data: marinaPlans.data,
      mime: marinaPlans.mime,
      width: marinas.planWidth,
      height: marinas.planHeight,
      pxPerMeter: marinas.planPxPerMeter,
      version: marinas.planVersion,
    })
    .from(marinaPlans)
    .innerJoin(marinas, eq(marinas.id, marinaPlans.marinaId))
    .where(eq(marinaPlans.marinaId, ctx.marinaId))
    .limit(1);
  if (!row || !row.width || !row.height) return { ok: false, message: "Carica prima la foto del porto." };

  // Si registra prima della chiamata: anche un tentativo non riuscito conta per il limite giornaliero.
  await audit(ctx, ANALYSIS_ACTION, "pianta del porto", ctx.marinaId, "Richiesta di riconoscimento di pontili e banchine");

  let proposals;
  let notes;
  try {
    const result = await analyzePlanPhoto({ data: row.data, mime: row.mime, width: row.width, height: row.height }, row.pxPerMeter);
    proposals = toProposals(result, row.width, row.height);
    notes = result.notes.trim().slice(0, 400);
  } catch (error) {
    if (error instanceof PlanAnalysisError) return { ok: false, message: error.message };
    throw error;
  }
  if (proposals.length === 0) {
    return { ok: false, message: "Nella foto non sono stati riconosciuti pontili o banchine con barche. Prova con una foto più ravvicinata, oppure disponili a mano." };
  }

  const analysis: StoredAnalysis = { photoVersion: row.version, proposals, notes, scaleEstimate: estimateScale(proposals) };
  await db.update(marinaPlans).set({ analysis, analyzedAt: new Date() }).where(eq(marinaPlans.marinaId, ctx.marinaId));
  revalidatePath("/", "layout");
  return { ok: true, message: `Riconosciute ${proposals.length} strutture: controlla le proposte e conferma.` };
}

export async function discardPlanAnalysis(): Promise<Result> {
  const ctx = await requireMarina(["admin"]);
  await db.update(marinaPlans).set({ analysis: null, analyzedAt: null }).where(eq(marinaPlans.marinaId, ctx.marinaId));
  revalidatePath("/", "layout");
  return { ok: true, message: "Proposte scartate." };
}

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
const proposalsInput = z.object({
  // Scala da usare se il porto non ne ha ancora una (quella stimata dall'analisi).
  scale: z.number().positive().max(2000).nullable(),
  items: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9]{1,4}$/, "Sigla non valida: da 1 a 4 lettere o cifre"),
        name: z.string().trim().min(1, "Manca il nome").max(60),
        kind: z.enum(["pontile", "banchina"]),
        a: pointSchema,
        b: pointSchema,
        sides: z
          .array(z.object({ side: z.enum(["sx", "dx"]), count: z.number().int().min(1).max(MAX_BERTHS_PER_SIDE), categoryId: z.uuid() }))
          .min(1)
          .max(2),
      }),
    )
    .min(1)
    .max(40),
});

export type ProposalsInput = z.infer<typeof proposalsInput>;

/** Crea pontili e posti dalle proposte confermate, già disposti sulla foto. */
export async function createFromProposals(input: ProposalsInput): Promise<Result> {
  const ctx = await requireMarina(["admin"]);
  const parsed = proposalsInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dati non validi." };
  const { items, scale } = parsed.data;

  const [marina] = await db
    .select({ width: marinas.planWidth, height: marinas.planHeight, pxPerMeter: marinas.planPxPerMeter })
    .from(marinas)
    .where(eq(marinas.id, ctx.marinaId));
  if (!marina?.width || !marina.height) return { ok: false, message: "Carica prima la foto del porto." };
  const pxPerMeter = marina.pxPerMeter ?? scale;
  if (!pxPerMeter) return { ok: false, message: "Imposta prima la scala della foto." };

  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x <= marina.width! && p.y <= marina.height!;
  if (items.some((i) => !inside(i.a) || !inside(i.b))) return { ok: false, message: "Alcune linee escono dalla foto." };
  if (items.some((i) => new Set(i.sides.map((s) => s.side)).size !== i.sides.length)) return { ok: false, message: "Ogni lato può comparire una sola volta." };

  const codes = items.map((i) => i.code);
  const duplicate = codes.find((c, i) => codes.indexOf(c) !== i);
  if (duplicate) return { ok: false, message: `La sigla ${duplicate} è usata due volte.` };

  const [existingPiers, categories] = await Promise.all([
    db.select({ code: piers.code, name: piers.name, sortOrder: piers.sortOrder }).from(piers).where(eq(piers.marinaId, ctx.marinaId)),
    db.select().from(berthCategories).where(eq(berthCategories.marinaId, ctx.marinaId)),
  ]);
  const taken = existingPiers.find((p) => codes.includes(p.code.toUpperCase()));
  if (taken) return { ok: false, message: `Esiste già un pontile con sigla ${taken.code}: scegline un'altra.` };
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  if (items.some((i) => i.sides.some((s) => !categoryById.has(s.categoryId)))) return { ok: false, message: "Categoria non trovata." };

  // I codici dei posti (es. C01) non devono scontrarsi con posti già esistenti.
  const planned = items.map((item) => ({
    item,
    berths: planBerths(
      item.code,
      item.kind,
      item.a,
      item.b,
      item.sides.map((s) => ({ side: s.side, count: s.count, lengthCm: categoryById.get(s.categoryId)!.maxLengthCm, beamCm: categoryById.get(s.categoryId)!.maxBeamCm })),
      pxPerMeter,
    ),
  }));
  const allCodes = planned.flatMap((p) => p.berths.map((b) => b.code));
  const clash = await db
    .select({ code: berths.code })
    .from(berths)
    .where(and(eq(berths.marinaId, ctx.marinaId), inArray(berths.code, allCodes)))
    .limit(1);
  if (clash.length > 0) return { ok: false, message: `Esiste già un posto ${clash[0].code}: cambia la sigla di quella struttura.` };

  const total = allCodes.length;
  await db.transaction(async (tx) => {
    if (!marina.pxPerMeter) await tx.update(marinas).set({ planPxPerMeter: pxPerMeter }).where(eq(marinas.id, ctx.marinaId));
    let order = existingPiers.reduce((max, p) => Math.max(max, p.sortOrder), -1) + 1;
    for (const { item, berths: rows } of planned) {
      const [pier] = await tx
        .insert(piers)
        .values({
          marinaId: ctx.marinaId,
          code: item.code,
          name: item.name,
          sortOrder: order++,
          planAx: item.a.x,
          planAy: item.a.y,
          planBx: item.b.x,
          planBy: item.b.y,
          planWidthM: structureWidthM(item.kind),
        })
        .returning({ id: piers.id });
      const categoryOf = new Map(item.sides.map((s) => [s.side, s.categoryId]));
      await tx.insert(berths).values(
        rows.map((r) => ({
          marinaId: ctx.marinaId,
          pierId: pier.id,
          categoryId: categoryOf.get(r.side)!,
          code: r.code,
          side: r.side,
          position: r.position,
          lengthCm: r.lengthCm,
          beamCm: r.beamCm,
          planX: r.placement.x,
          planY: r.placement.y,
          planAngle: r.placement.angle,
        })),
      );
    }
    await tx.update(marinaPlans).set({ analysis: null, analyzedAt: null }).where(eq(marinaPlans.marinaId, ctx.marinaId));
    await audit(ctx, "creazione", "pontili dalla foto", ctx.marinaId, `${items.length} strutture, ${total} posti (${codes.join(", ")})`, tx);
  });

  revalidatePath("/", "layout");
  // Nomi già usati (da pontili di prima o tra quelli nuovi): in Pontili e posti si può decidere se unirli.
  const keys = [...existingPiers.map((p) => p.name), ...items.map((i) => i.name)].map(pierGroupKey);
  const repeated = [...new Set(items.map((i) => i.name.trim()).filter((name) => keys.filter((k) => k === pierGroupKey(name)).length > 1))];
  const note = repeated.length
    ? ` ${repeated.map((n) => `«${n}»`).join(", ")} ${repeated.length === 1 ? "ha" : "hanno"} lo stesso nome di un altro pontile: in Impostazioni → Pontili e posti puoi unirli.`
    : "";
  return { ok: true, message: `Creati ${items.length} ${items.length === 1 ? "pontile" : "pontili e banchine"} con ${total} posti, già disposti sulla foto.${note}` };
}

// ───────────────────────── Sfondo e servizi della mappa ─────────────────────────

const featurePoint = z.object({ x: z.number().finite(), y: z.number().finite() });
const featuresSchema = z
  .array(
    z.object({
      kind: z.enum(["terra", "acqua", "edificio", "verde", "servizio"]),
      service: z.string().max(40).nullable(),
      name: z.string().max(80).nullable(),
      points: z.array(featurePoint).min(1).max(5000),
      source: z.enum(["manuale", "colori", "claude"]),
    }),
  )
  .max(3000);

export type FeaturesInput = z.infer<typeof featuresSchema>;

/** Salva tutto lo sfondo della mappa (sostituisce quello di prima). */
export async function savePlanFeatures(input: FeaturesInput): Promise<Result> {
  const ctx = await requireMarina(["admin"]);
  const parsed = featuresSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dati dello sfondo non validi." };
  const features = parsed.data;
  if (features.reduce((sum, f) => sum + f.points.length, 0) > 200_000) return { ok: false, message: "Lo sfondo è troppo dettagliato: semplificalo." };

  const [marina] = await db.select({ width: marinas.planWidth, height: marinas.planHeight }).from(marinas).where(eq(marinas.id, ctx.marinaId));
  if (!marina?.width || !marina.height) return { ok: false, message: "Carica prima la foto del porto." };
  const margin = 0.1;
  const inside = (p: { x: number; y: number }) =>
    p.x >= -marina.width! * margin && p.x <= marina.width! * (1 + margin) && p.y >= -marina.height! * margin && p.y <= marina.height! * (1 + margin);
  for (const f of features) {
    if (!f.points.every(inside)) return { ok: false, message: "Alcuni elementi sono fuori dalla foto." };
    if (f.kind === "servizio" ? f.points.length !== 1 || !isServiceKey(f.service) : f.points.length < 3) {
      return { ok: false, message: "Un elemento dello sfondo non è completo." };
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(planFeatures).where(eq(planFeatures.marinaId, ctx.marinaId));
    if (features.length > 0) {
      await tx.insert(planFeatures).values(
        features.map((f, i) => ({
          marinaId: ctx.marinaId,
          kind: f.kind,
          service: f.kind === "servizio" ? f.service : null,
          name: f.name?.trim() || null,
          points: f.points.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
          source: f.source,
          sortOrder: i,
        })),
      );
    }
    const services = features.filter((f) => f.kind === "servizio").length;
    await audit(ctx, "modifica", "sfondo della mappa", ctx.marinaId, `${features.length - services} forme, ${services} servizi`, tx);
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Sfondo salvato: lo trovi nello schema della mappa." };
}

/** Chiede a Claude edifici, aree verdi e servizi: le proposte tornano all'editor, che le mostra in attesa di salvataggio. */
export async function analyzeSurroundings(): Promise<Result & { features?: Omit<PlanFeature, "id">[] }> {
  const ctx = await requireMarina(["admin"]);
  if (!planAnalysisAvailable()) {
    return { ok: false, message: "Il riconoscimento automatico non è ancora attivo (istruzioni in COME-LAVORIAMO.md). Puoi disegnare edifici e servizi a mano." };
  }
  if (await dailyLimitReached(ctx.marinaId)) return { ok: false, message: LIMIT_MESSAGE };

  const [row] = await db
    .select({ data: marinaPlans.data, mime: marinaPlans.mime, width: marinas.planWidth, height: marinas.planHeight })
    .from(marinaPlans)
    .innerJoin(marinas, eq(marinas.id, marinaPlans.marinaId))
    .where(eq(marinaPlans.marinaId, ctx.marinaId))
    .limit(1);
  if (!row || !row.width || !row.height) return { ok: false, message: "Carica prima la foto del porto." };

  await audit(ctx, ANALYSIS_ACTION, "pianta del porto", ctx.marinaId, "Richiesta di riconoscimento di edifici e servizi");
  try {
    const result = await analyzeSurroundingsPhoto({ data: row.data, mime: row.mime, width: row.width, height: row.height });
    const features = surroundingsToFeatures(result, row.width, row.height);
    if (features.length === 0) return { ok: false, message: "Nella foto non sono stati riconosciuti edifici o servizi: disegnali a mano." };
    const services = features.filter((f) => f.kind === "servizio").length;
    const notes = result.notes.trim().slice(0, 300);
    return {
      ok: true,
      message: `Proposti ${features.length - services} edifici e aree verdi e ${services} servizi: controllali, correggi dove serve e salva.${notes ? ` Nota: ${notes}` : ""}`,
      features,
    };
  } catch (error) {
    if (error instanceof PlanAnalysisError) return { ok: false, message: error.message };
    throw error;
  }
}
