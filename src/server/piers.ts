import "server-only";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { berthModules, berths, marinas, pierSections, piers, rates } from "@/db/schema";
import { compareCodes } from "@/lib/berth-codes";
import { appendPositions } from "@/lib/pier-merge";
import { berthSlots, layoutPier, mooringAlong } from "@/lib/plan";
import { clipTrace, estimateTrace, fitTrace, renumberPier, type Trace } from "@/lib/plan-extend";
import { mirrorBerths } from "@/lib/plan-mirror";
import { traceFromColumns, unitPositions } from "@/lib/plan-units";
import { DomainError } from "./errors";

type PierRow = typeof piers.$inferSelect;

const NO_TRACE = { planAx: null, planAy: null, planBx: null, planBy: null };

export interface MergeResult {
  target: { id: string; code: string; name: string };
  merged: { id: string; code: string; name: string }[];
  moved: number;
}

/**
 * Unisce i pontili `sourceIds` in `targetId`, tutti del porto `marinaId`. Per la gestione resta un pontile solo: i posti passano
 * al pontile che resta (con codici, misure e contratti) e i pontili uniti si eliminano (con i loro prezzi: chi ha lo stesso nome
 * condivide già quelli del pontile che resta). Sulla pianta invece ogni pontile di prima diventa un tratto (pier_sections) con la
 * sua linea e i suoi posti, che nell'editor si sposta, ruota e traccia da solo.
 */
export async function mergePiers(tx: Tx, marinaId: string, targetId: string, sourceIds: string[]): Promise<MergeResult> {
  const sources = [...new Set(sourceIds)].filter((id) => id !== targetId);
  if (sources.length === 0) throw new DomainError("Scegli almeno un pontile da unire.");
  const rows = await tx
    .select()
    .from(piers)
    .where(and(eq(piers.marinaId, marinaId), inArray(piers.id, [targetId, ...sources])))
    .for("update");
  const target = rows.find((p) => p.id === targetId);
  if (!target || rows.length !== sources.length + 1) throw new DomainError("Pontile non trovato.");

  const [berthRows, sectionRows] = await Promise.all([
    tx
      .select({ id: berths.id, pierId: berths.pierId, sectionId: berths.sectionId, side: berths.side, position: berths.position })
      .from(berths)
      .where(and(eq(berths.marinaId, marinaId), inArray(berths.pierId, [targetId, ...sources]))),
    tx
      .select({ id: pierSections.id, pierId: pierSections.pierId, sortOrder: pierSections.sortOrder })
      .from(pierSections)
      .where(and(eq(pierSections.marinaId, marinaId), inArray(pierSections.pierId, [targetId, ...sources]))),
  ]);
  let order = sectionRows.filter((s) => s.pierId === targetId).reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;

  // La parte di un pontile che segue la sua linea (posti senza tratto) diventa un tratto con quella linea.
  async function sectionFromPier(pier: PierRow): Promise<void> {
    const loose = berthRows.filter((b) => b.pierId === pier.id && !b.sectionId);
    const hasTrace = pier.planAx !== null && pier.planAy !== null && pier.planBx !== null && pier.planBy !== null;
    if (loose.length === 0 && !hasTrace) return;
    const [section] = await tx
      .insert(pierSections)
      .values({
        marinaId,
        pierId: targetId,
        label: pier.code,
        sortOrder: order++,
        planAx: pier.planAx,
        planAy: pier.planAy,
        planBx: pier.planBx,
        planBy: pier.planBy,
        planWidthM: pier.planWidthM,
      })
      .returning({ id: pierSections.id });
    await tx
      .update(berths)
      .set({ sectionId: section.id })
      .where(and(eq(berths.marinaId, marinaId), eq(berths.pierId, pier.id), isNull(berths.sectionId)));
  }

  // Il pontile che resta: alla prima unione anche lui diventa un tratto, e la linea passa al tratto.
  if (!sectionRows.some((s) => s.pierId === targetId)) {
    await sectionFromPier(target);
    await tx.update(piers).set(NO_TRACE).where(eq(piers.id, targetId));
  }

  const kept = berthRows.filter((b) => b.pierId === targetId);
  let moved = 0;
  const merged: MergeResult["merged"] = [];
  // Nell'ordine dei pontili: i posti del primo arrivano prima di quelli del secondo.
  const ordered = rows.filter((p) => p.id !== targetId).sort((p, q) => p.sortOrder - q.sortOrder || p.code.localeCompare(q.code));
  for (const source of ordered) {
    // Tratti di un pontile già unito in precedenza: passano così come sono.
    for (const s of sectionRows.filter((x) => x.pierId === source.id).sort((p, q) => p.sortOrder - q.sortOrder)) {
      await tx.update(pierSections).set({ pierId: targetId, sortOrder: order++ }).where(eq(pierSections.id, s.id));
    }
    await sectionFromPier(source);
    // Per la griglia della mappa (senza pianta) i posti proseguono, lato per lato, dopo quelli del pontile che resta.
    const incoming = berthRows.filter((b) => b.pierId === source.id);
    const positions = appendPositions(kept, incoming);
    for (const b of incoming) {
      const position = positions.get(b.id)!;
      await tx.update(berths).set({ pierId: targetId, position }).where(eq(berths.id, b.id));
      kept.push({ ...b, pierId: targetId, position });
    }
    moved += incoming.length;
    merged.push({ id: source.id, code: source.code, name: source.name });
  }

  await tx.delete(piers).where(and(eq(piers.marinaId, marinaId), inArray(piers.id, sources)));
  return { target: { id: target.id, code: target.code, name: target.name }, merged, moved };
}

/**
 * Fa dei posti scelti un tratto della pianta del pontile (per esempio in un pontile unito prima che esistessero i tratti):
 * nell'editor il tratto si sposta, ruota e traccia da solo. I tratti rimasti senza posti si eliminano.
 */
export async function sectionFromBerths(tx: Tx, marinaId: string, pierId: string, berthIds: string[], label: string): Promise<number> {
  if (berthIds.length === 0) throw new DomainError("Scegli almeno un posto.");
  const [pier] = await tx
    .select({ id: piers.id })
    .from(piers)
    .where(and(eq(piers.id, pierId), eq(piers.marinaId, marinaId)))
    .for("update");
  if (!pier) throw new DomainError("Pontile non trovato.");
  const picked = await tx
    .select({ id: berths.id, sectionId: berths.sectionId })
    .from(berths)
    .where(and(eq(berths.marinaId, marinaId), eq(berths.pierId, pierId), inArray(berths.id, berthIds)));
  if (picked.length === 0) throw new DomainError("Scegli almeno un posto.");

  const sections = await tx
    .select({ id: pierSections.id, sortOrder: pierSections.sortOrder })
    .from(pierSections)
    .where(and(eq(pierSections.marinaId, marinaId), eq(pierSections.pierId, pierId)));
  const [section] = await tx
    .insert(pierSections)
    .values({ marinaId, pierId, label, sortOrder: sections.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1 })
    .returning({ id: pierSections.id });
  await tx
    .update(berths)
    .set({ sectionId: section.id })
    .where(
      and(
        eq(berths.marinaId, marinaId),
        inArray(
          berths.id,
          picked.map((b) => b.id),
        ),
      ),
    );

  // I tratti da cui venivano i posti, se ora sono vuoti, non servono più.
  const left = [...new Set(picked.map((b) => b.sectionId).filter((id): id is string => id !== null))];
  for (const id of left) {
    const [still] = await tx.select({ id: berths.id }).from(berths).where(eq(berths.sectionId, id)).limit(1);
    if (!still) await tx.delete(pierSections).where(and(eq(pierSections.id, id), eq(pierSections.marinaId, marinaId)));
  }
  await fitLines(tx, marinaId, pierId, section.id, left, picked.some((b) => b.sectionId === null));
  return picked.length;
}

/**
 * Linee della pianta dopo aver fatto un tratto: il tratto nuovo prende la linea ricavata dai suoi posti; le linee dei pezzi
 * da cui venivano (tratti o il pontile) si accorciano ai posti rimasti, così sulla mappa non coprono il tratto nuovo.
 * Il pontile senza più posti fuori dai tratti perde la sua linea.
 */
async function fitLines(tx: Tx, marinaId: string, pierId: string, newSectionId: string, fromSections: string[], fromPier: boolean) {
  const [marina] = await tx.select({ m: marinas.planPxPerMeter }).from(marinas).where(eq(marinas.id, marinaId));
  const m = marina?.m;
  const rows = await tx
    .select({ sectionId: berths.sectionId, side: berths.side, position: berths.position, x: berths.planX, y: berths.planY, angle: berths.planAngle, lengthCm: berths.lengthCm, beamCm: berths.beamCm })
    .from(berths)
    .where(and(eq(berths.marinaId, marinaId), eq(berths.pierId, pierId)));
  const placedIn = (sectionId: string | null) =>
    rows.flatMap((b) => (b.sectionId === sectionId && b.x !== null && b.y !== null ? [{ ...b, x: b.x, y: b.y, angle: b.angle ?? 0 }] : []));
  if (m) {
    const own = estimateTrace(placedIn(newSectionId), m);
    if (own) await tx.update(pierSections).set(lineColumns(own)).where(eq(pierSections.id, newSectionId));
  }
  for (const id of fromSections) {
    const [sec] = await tx.select().from(pierSections).where(eq(pierSections.id, id));
    const line = sec ? traceFromColumns(sec) : null;
    if (line && m) await tx.update(pierSections).set(lineColumns(clipTrace(line, placedIn(id), m))).where(eq(pierSections.id, id));
  }
  if (fromPier) {
    const [pier] = await tx.select().from(piers).where(eq(piers.id, pierId));
    const line = pier ? traceFromColumns(pier) : null;
    const loose = rows.filter((b) => b.sectionId === null);
    if (line && loose.length === 0) await tx.update(piers).set(lineColumns(null)).where(eq(piers.id, pierId));
    else if (line && m) await tx.update(piers).set(lineColumns(clipTrace(line, placedIn(null), m))).where(eq(piers.id, pierId));
  }
}

// ───────────────────────── Tratti di un pontile ─────────────────────────

export type BerthLayout = "alternati" | "sx" | "dx";

const lineColumns = (t: Trace | null) => ({ planAx: t?.a.x ?? null, planAy: t?.a.y ?? null, planBx: t?.b.x ?? null, planBy: t?.b.y ?? null, planWidthM: t?.widthM ?? null });

async function loadPier(tx: Tx, marinaId: string, pierId: string) {
  const [pier] = await tx
    .select()
    .from(piers)
    .where(and(eq(piers.id, pierId), eq(piers.marinaId, marinaId)))
    .for("update");
  if (!pier) throw new DomainError("Pontile non trovato.");
  const [sections, rows] = await Promise.all([
    tx
      .select()
      .from(pierSections)
      .where(and(eq(pierSections.pierId, pierId), eq(pierSections.marinaId, marinaId)))
      .orderBy(asc(pierSections.sortOrder)),
    tx
      .select({
        id: berths.id,
        code: berths.code,
        sectionId: berths.sectionId,
        side: berths.side,
        position: berths.position,
        x: berths.planX,
        y: berths.planY,
        angle: berths.planAngle,
        lengthCm: berths.lengthCm,
        beamCm: berths.beamCm,
      })
      .from(berths)
      .where(and(eq(berths.pierId, pierId), eq(berths.marinaId, marinaId))),
  ]);
  return { pier, sections, rows };
}

async function loadSection(tx: Tx, marinaId: string, sectionId: string) {
  const [section] = await tx
    .select()
    .from(pierSections)
    .where(and(eq(pierSections.id, sectionId), eq(pierSections.marinaId, marinaId)))
    .for("update");
  if (!section) throw new DomainError("Tratto non trovato.");
  return section;
}

/**
 * Ridispone i posti di un tratto (o del pontile, con `sectionId` null): in ordine di codice dalla radice, alternati sui due lati
 * o tutti da una parte. Le posizioni del pontile si rinumerano tratto dopo tratto; sulla pianta i posti si rimettono lungo la
 * linea del tratto (quella tracciata o, se manca, quella ricavata dai posti, che da allora resta salvata).
 * Restituisce quanti posti ha disposto e se li ha rimessi anche sulla pianta.
 */
export async function arrangeUnit(tx: Tx, marinaId: string, pierId: string, sectionId: string | null, layout: BerthLayout): Promise<{ count: number; onPlan: boolean }> {
  const { pier, sections, rows } = await loadPier(tx, marinaId, pierId);
  const section = sectionId ? sections.find((s) => s.id === sectionId) : null;
  if (sectionId && !section) throw new DomainError("Tratto non trovato.");
  const known = new Set(sections.map((s) => s.id));
  const groupOf = (b: { sectionId: string | null }) => (b.sectionId && known.has(b.sectionId) ? b.sectionId : null);
  const unit = rows.filter((b) => groupOf(b) === (sectionId ?? null)).sort((p, q) => compareCodes(p.code, q.code));
  if (unit.length === 0) throw new DomainError("Non ci sono posti da disporre.");

  // Lato e posizione nuovi dentro il tratto, contati dalla sua radice.
  const slots = berthSlots(layout, unit.length, 0, 0);
  const rel = new Map(unit.map((b, i) => [b.id, slots[i]]));
  const groups = [...sections.map((s) => s.id), null].map((g) =>
    rows.filter((b) => groupOf(b) === g).map((b) => ({ id: b.id, side: rel.get(b.id)?.side ?? b.side, position: rel.get(b.id)?.position ?? b.position })),
  );
  const positions = renumberPier(groups);
  for (const b of rows) {
    const side = rel.get(b.id)?.side ?? b.side;
    const position = positions.get(b.id) ?? b.position;
    if (side !== b.side || position !== b.position) await tx.update(berths).set({ side, position }).where(eq(berths.id, b.id));
  }

  const [marina] = await tx.select({ pxPerMeter: marinas.planPxPerMeter }).from(marinas).where(eq(marinas.id, marinaId));
  const m = marina?.pxPerMeter;
  if (!m) return { count: unit.length, onPlan: false };
  const saved = traceFromColumns(section ?? pier);
  const placed = unit.flatMap((b) => (b.x !== null && b.y !== null ? [{ ...b, x: b.x, y: b.y, angle: b.angle ?? 0 }] : []));
  const base = saved ?? estimateTrace(placed, m);
  if (!base) return { count: unit.length, onPlan: false };
  // L'ormeggio resta quello dei posti già disposti (di punta o all'inglese, rispetto alla linea).
  const baseLen = Math.hypot(base.b.x - base.a.x, base.b.y - base.a.y) || 1;
  const mooring = mooringAlong(placed, { x: (base.b.x - base.a.x) / baseLen, y: (base.b.y - base.a.y) / baseLen });
  // Con più posti per lato di prima (es. tutti da una parte) la linea si allunga quanto serve, per non sovrapporli.
  const slotCount = Math.max(...[...rel.values()].map((r) => r.position)) + 1;
  const span = Math.max(...unit.map((b) => (mooring === "inglese" ? b.lengthCm : b.beamCm)));
  const trace = fitTrace(base, slotCount, (span / 100) * m);
  const placements = layoutPier(
    unit.map((b) => ({ id: b.id, side: rel.get(b.id)!.side, position: rel.get(b.id)!.position, lengthCm: b.lengthCm, beamCm: b.beamCm })),
    trace.a,
    trace.b,
    m,
    trace.widthM,
    false,
    mooring,
  );
  // Ridisposti in fila: il modulo si riconosce di nuovo all'apertura dell'editor.
  for (const p of placements) await tx.update(berths).set({ planX: p.x, planY: p.y, planAngle: p.angle, planModule: null }).where(eq(berths.id, p.id));
  if (trace !== saved) {
    if (section) await tx.update(pierSections).set(lineColumns(trace)).where(eq(pierSections.id, section.id));
    else await tx.update(piers).set(lineColumns(trace)).where(eq(piers.id, pier.id));
  }
  return { count: unit.length, onPlan: placements.length > 0 };
}

/** Posti scelti di un pontile, tutti dello stesso tratto (o tutti fuori dai tratti): restituisce posti, tratto e pontile. */
async function unitBerths(tx: Tx, marinaId: string, pierId: string, berthIds: string[]) {
  const { pier, sections, rows } = await loadPier(tx, marinaId, pierId);
  const known = new Set(sections.map((sec) => sec.id));
  const groupOf = (b: { sectionId: string | null }) => (b.sectionId && known.has(b.sectionId) ? b.sectionId : null);
  const ids = new Set(berthIds);
  const list = rows.filter((b) => ids.has(b.id));
  if (list.length === 0 || list.length !== ids.size) throw new DomainError("Posti non trovati in questo pontile.");
  const units = new Set(list.map(groupOf));
  if (units.size > 1) throw new DomainError("I posti devono essere dello stesso tratto.");
  const sectionId = [...units][0];
  const section = sectionId ? sections.find((sec) => sec.id === sectionId)! : null;
  const whole = rows.filter((b) => groupOf(b) === sectionId).length === list.length;
  return { pier, section, list, whole };
}

/**
 * Gira la numerazione di un gruppo di posti dello stesso tratto (il tratto intero o un suo modulo):
 * «estremi» = il primo posto passa all'altra estremità (posizioni rovesciate), «lati» = sinistra e destra si scambiano.
 * Sulla pianta i posti si specchiano rispetto al pontile, così ogni codice va dove ora dice la numerazione.
 */
export async function flipNumbering(tx: Tx, marinaId: string, pierId: string, berthIds: string[], mode: "estremi" | "lati"): Promise<number> {
  const { pier, section, list, whole } = await unitBerths(tx, marinaId, pierId, berthIds);
  if (list.length < 2) throw new DomainError("Servono almeno due posti.");
  const lo = Math.min(...list.map((b) => b.position));
  const hi = Math.max(...list.map((b) => b.position));
  for (const b of list) {
    const set = mode === "estremi" ? { position: lo + hi - b.position } : { side: b.side === "sx" ? ("dx" as const) : ("sx" as const) };
    await tx.update(berths).set(set).where(eq(berths.id, b.id));
  }

  const [marina] = await tx.select({ pxPerMeter: marinas.planPxPerMeter }).from(marinas).where(eq(marinas.id, marinaId));
  const m = marina?.pxPerMeter;
  const placed = list.flatMap((b) => (b.x !== null && b.y !== null ? [{ ...b, x: b.x, y: b.y, angle: b.angle ?? 0 }] : []));
  if (placed.length < 2) return list.length;
  // La linea tracciata del tratto intero; per un modulo (o senza linea) quella ricavata dai posti, che richiede la scala.
  const saved = whole ? traceFromColumns(section ?? pier) : null;
  const line = saved ?? (m ? estimateTrace(placed, m) : null);
  if (!line) return list.length;
  for (const p of mirrorBerths(placed, line, mode)) {
    await tx.update(berths).set({ planX: p.x, planY: p.y, planAngle: p.angle }).where(eq(berths.id, p.id));
  }
  // La radice della linea resta dove ora c'è il primo posto.
  if (saved && mode === "estremi") {
    const reversed = { ...saved, a: saved.b, b: saved.a };
    if (section) await tx.update(pierSections).set(lineColumns(reversed)).where(eq(pierSections.id, section.id));
    else await tx.update(piers).set(lineColumns(reversed)).where(eq(piers.id, pier.id));
  }
  return list.length;
}

/**
 * Nome di un modulo della pianta (vuoto = torna «Modulo N»). I posti del modulo ricevono il suo numero, così il nome resta
 * legato a loro anche se i moduli non erano ancora stati salvati dall'editor.
 */
export async function renameModule(tx: Tx, marinaId: string, pierId: string, berthIds: string[], module: number, name: string): Promise<void> {
  const { pier, section, list } = await unitBerths(tx, marinaId, pierId, berthIds);
  for (const b of list) await tx.update(berths).set({ planModule: module }).where(eq(berths.id, b.id));
  const where = and(
    eq(berthModules.pierId, pier.id),
    section ? eq(berthModules.sectionId, section.id) : isNull(berthModules.sectionId),
    eq(berthModules.module, module),
  );
  await tx.delete(berthModules).where(where);
  if (name) await tx.insert(berthModules).values({ marinaId, pierId: pier.id, sectionId: section?.id ?? null, module, name });
}

export async function renameSection(tx: Tx, marinaId: string, sectionId: string, label: string): Promise<void> {
  await loadSection(tx, marinaId, sectionId);
  await tx.update(pierSections).set({ label }).where(eq(pierSections.id, sectionId));
}

/** Toglie il tratto: i suoi posti tornano a seguire la linea del pontile (che, se manca, prende quella del tratto). */
export async function dissolveSection(tx: Tx, marinaId: string, sectionId: string): Promise<{ label: string; pierId: string }> {
  const section = await loadSection(tx, marinaId, sectionId);
  await tx.update(berths).set({ sectionId: null }).where(and(eq(berths.sectionId, sectionId), eq(berths.marinaId, marinaId)));
  const [pier] = await tx.select().from(piers).where(eq(piers.id, section.pierId));
  if (pier && !traceFromColumns(pier)) await tx.update(piers).set(lineColumns(traceFromColumns(section))).where(eq(piers.id, pier.id));
  await tx.delete(pierSections).where(eq(pierSections.id, sectionId));
  return { label: section.label, pierId: section.pierId };
}

/**
 * Separa un tratto in un pontile a sé (annulla l'unione per quel tratto): nuovo pontile subito dopo, con i posti del tratto,
 * la sua linea, la scelta della tariffa base e i prezzi propri del pontile da cui viene. Se al pontile di partenza resta un solo
 * tratto e nessun altro posto, il tratto si toglie.
 */
export async function splitSection(tx: Tx, marinaId: string, sectionId: string, data: { code: string; name: string }): Promise<{ pierId: string; moved: number }> {
  const section = await loadSection(tx, marinaId, sectionId);
  const { pier, sections, rows } = await loadPier(tx, marinaId, section.pierId);

  await tx
    .update(piers)
    .set({ sortOrder: sql`${piers.sortOrder} + 1` })
    .where(and(eq(piers.marinaId, marinaId), gt(piers.sortOrder, pier.sortOrder)));
  const [created] = await tx
    .insert(piers)
    .values({ marinaId, code: data.code, name: data.name, sortOrder: pier.sortOrder + 1, baseRate: pier.baseRate, ...lineColumns(traceFromColumns(section)) })
    .returning({ id: piers.id });

  const own = await tx.select().from(rates).where(and(eq(rates.marinaId, marinaId), eq(rates.pierId, pier.id)));
  if (own.length > 0) await tx.insert(rates).values(own.map(({ id: _id, ...r }) => ({ ...r, pierId: created.id })));

  const moving = rows.filter((b) => b.sectionId === sectionId);
  const positions = unitPositions(moving);
  for (const b of moving) {
    await tx.update(berths).set({ pierId: created.id, sectionId: null, position: positions.get(b.id) ?? b.position }).where(eq(berths.id, b.id));
  }
  await tx.delete(pierSections).where(eq(pierSections.id, sectionId));

  const left = sections.filter((s) => s.id !== sectionId);
  const loose = rows.filter((b) => b.sectionId !== sectionId && (!b.sectionId || !left.some((s) => s.id === b.sectionId)));
  if (left.length === 1 && loose.length === 0) await dissolveSection(tx, marinaId, left[0].id);
  return { pierId: created.id, moved: moving.length };
}

/**
 * Divide un pontile (o un suo tratto) in due tratti dello stesso pontile, in ordine di codice: fino al posto prima di `fromBerthId`
 * il primo, da lì in poi il secondo. Il pontile resta uno solo (sigla, prezzi, categorie e codici dei posti non cambiano); sulla
 * pianta i due tratti si spostano e si tracciano da soli, come quelli di un'unione.
 */
export async function splitUnitAt(
  tx: Tx,
  marinaId: string,
  pierId: string,
  sectionId: string | null,
  fromBerthId: string,
  labels: { first: string; second: string },
): Promise<{ first: number; second: number }> {
  const { sections, rows } = await loadPier(tx, marinaId, pierId);
  if (sectionId && !sections.some((s) => s.id === sectionId)) throw new DomainError("Tratto non trovato.");
  const known = new Set(sections.map((s) => s.id));
  const unit = rows
    .filter((b) => (sectionId ? b.sectionId === sectionId : !b.sectionId || !known.has(b.sectionId)))
    .sort((p, q) => compareCodes(p.code, q.code));
  const at = unit.findIndex((b) => b.id === fromBerthId);
  if (at < 1) throw new DomainError("Scegli il posto da cui parte il secondo tratto (non il primo).", "fromBerthId");
  const first = unit.slice(0, at).map((b) => b.id);
  const second = unit.slice(at).map((b) => b.id);
  if (sectionId) {
    await tx.update(pierSections).set({ label: labels.first }).where(eq(pierSections.id, sectionId));
  } else {
    await sectionFromBerths(tx, marinaId, pierId, first, labels.first);
  }
  await sectionFromBerths(tx, marinaId, pierId, second, labels.second);
  return { first: first.length, second: second.length };
}
