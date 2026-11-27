import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  berthModules,
  berths,
  marinas,
  pierSections,
  piers,
  settingsHistory,
} from "@/db/schema";
import { activeContractMessage, activeContractsOnBerths } from "./contracts";
import { DomainError } from "./errors";

// «Indietro» e «Avanti» per le modifiche già salvate nelle impostazioni (Pontili e posti, Impostazioni → Porto).
// Ogni modifica registra com'era prima e com'è dopo; si annulla (o si ripete) solo se da allora non è cambiato nulla.

export type HistoryArea = "pontile" | "porto";
export interface HistoryActor {
  marinaId: string;
  userId: string;
}

const MAX_PER_TARGET = 30;

/** JSON con le chiavi in ordine: due fotografie uguali danno lo stesso testo. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

// ───────── Pontile: posti, tratti, moduli e linea ─────────

const BERTH_FIELDS = {
  id: berths.id,
  code: berths.code,
  side: berths.side,
  position: berths.position,
  sectionId: berths.sectionId,
  categoryId: berths.categoryId,
  lengthCm: berths.lengthCm,
  beamCm: berths.beamCm,
  draftCm: berths.draftCm,
  hasWater: berths.hasWater,
  hasPower: berths.hasPower,
  status: berths.status,
  notes: berths.notes,
  planX: berths.planX,
  planY: berths.planY,
  planAngle: berths.planAngle,
  planModule: berths.planModule,
};

export async function snapshotPier(
  tx: Tx | typeof db,
  marinaId: string,
  pierId: string,
) {
  const [pier] = await tx
    .select({
      planAx: piers.planAx,
      planAy: piers.planAy,
      planBx: piers.planBx,
      planBy: piers.planBy,
      planWidthM: piers.planWidthM,
    })
    .from(piers)
    .where(and(eq(piers.id, pierId), eq(piers.marinaId, marinaId)));
  if (!pier) throw new DomainError("Pontile non trovato.");
  // Una dopo l'altra: dentro una transazione il collegamento al database è uno solo.
  const sections = await tx
    .select({
      id: pierSections.id,
      label: pierSections.label,
      sortOrder: pierSections.sortOrder,
      planAx: pierSections.planAx,
      planAy: pierSections.planAy,
      planBx: pierSections.planBx,
      planBy: pierSections.planBy,
      planWidthM: pierSections.planWidthM,
    })
    .from(pierSections)
    .where(
      and(eq(pierSections.pierId, pierId), eq(pierSections.marinaId, marinaId)),
    )
    .orderBy(asc(pierSections.id));
  const rows = await tx
    .select(BERTH_FIELDS)
    .from(berths)
    .where(and(eq(berths.pierId, pierId), eq(berths.marinaId, marinaId)))
    .orderBy(asc(berths.id));
  const modules = await tx
    .select({
      sectionId: berthModules.sectionId,
      module: berthModules.module,
      name: berthModules.name,
    })
    .from(berthModules)
    .where(
      and(eq(berthModules.pierId, pierId), eq(berthModules.marinaId, marinaId)),
    )
    .orderBy(asc(berthModules.sectionId), asc(berthModules.module));
  return { pier, sections, berths: rows, modules };
}

export type PierSnapshot = Awaited<ReturnType<typeof snapshotPier>>;

/** Rimette il pontile com'era nella fotografia: posti (con codici, lati, posizioni, tratti, misure, pianta), tratti, nomi dei moduli, linea. */
async function restorePier(
  tx: Tx,
  marinaId: string,
  pierId: string,
  snap: PierSnapshot,
) {
  const current = await snapshotPier(tx, marinaId, pierId);
  const now = new Map(current.berths.map((b) => [b.id, b]));
  if (snap.berths.some((b) => !now.has(b.id)))
    throw new DomainError(
      "Alcuni posti di allora non ci sono più: non si può tornare indietro.",
    );
  // Un codice cambia solo se il posto non ha un contratto attivo (lo stampa il contratto).
  const recoded = snap.berths.filter((b) => now.get(b.id)!.code !== b.code);
  const active = await activeContractsOnBerths(
    tx,
    marinaId,
    recoded.map((b) => b.id),
  );
  if (active.length > 0) throw new DomainError(activeContractMessage(active));

  const existing = new Set(current.sections.map((s) => s.id));
  for (const s of snap.sections) {
    const { id, ...fields } = s;
    if (existing.has(id))
      await tx.update(pierSections).set(fields).where(eq(pierSections.id, id));
    else
      await tx.insert(pierSections).values({ id, marinaId, pierId, ...fields });
  }
  // Prima codici provvisori, poi quelli di allora: due posti possono anche scambiarsi il codice.
  for (const b of recoded)
    await tx
      .update(berths)
      .set({ code: `~${b.id}` })
      .where(eq(berths.id, b.id));
  for (const b of snap.berths) {
    const { id, ...fields } = b;
    await tx
      .update(berths)
      .set(fields)
      .where(and(eq(berths.id, id), eq(berths.marinaId, marinaId)));
  }
  const keep = new Set(snap.sections.map((s) => s.id));
  const drop = current.sections.filter((s) => !keep.has(s.id)).map((s) => s.id);
  if (drop.length)
    await tx
      .delete(pierSections)
      .where(
        and(
          inArray(pierSections.id, drop),
          eq(pierSections.marinaId, marinaId),
        ),
      );
  await tx
    .delete(berthModules)
    .where(
      and(eq(berthModules.pierId, pierId), eq(berthModules.marinaId, marinaId)),
    );
  if (snap.modules.length)
    await tx
      .insert(berthModules)
      .values(snap.modules.map((m) => ({ marinaId, pierId, ...m })));
  await tx
    .update(piers)
    .set(snap.pier)
    .where(and(eq(piers.id, pierId), eq(piers.marinaId, marinaId)));
}

// ───────── Porto: i campi di Impostazioni → Porto ─────────

type MarinaRow = typeof marinas.$inferSelect;

async function snapshotMarina(
  tx: Tx | typeof db,
  marinaId: string,
  keys: string[],
): Promise<Record<string, unknown>> {
  const [row] = await tx.select().from(marinas).where(eq(marinas.id, marinaId));
  if (!row) throw new DomainError("Porto non trovato.");
  return Object.fromEntries(
    keys.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]),
  );
}

async function restoreMarina(
  tx: Tx,
  marinaId: string,
  values: Record<string, unknown>,
) {
  await tx
    .update(marinas)
    .set(values as Partial<MarinaRow>)
    .where(eq(marinas.id, marinaId));
}

// ───────── Registrare, annullare, ripetere ─────────

async function record(
  tx: Tx,
  actor: HistoryActor,
  area: HistoryArea,
  targetId: string,
  label: string,
  before: unknown,
  after: unknown,
) {
  if (canonical(before) === canonical(after)) return;
  // Una modifica nuova chiude la strada ad «Avanti».
  await tx
    .delete(settingsHistory)
    .where(
      and(
        eq(settingsHistory.marinaId, actor.marinaId),
        eq(settingsHistory.area, area),
        eq(settingsHistory.targetId, targetId),
        eq(settingsHistory.undone, true),
      ),
    );
  await tx
    .insert(settingsHistory)
    .values({
      marinaId: actor.marinaId,
      userId: actor.userId,
      area,
      targetId,
      label,
      before,
      after,
    });
  const old = await tx
    .select({ id: settingsHistory.id })
    .from(settingsHistory)
    .where(
      and(
        eq(settingsHistory.marinaId, actor.marinaId),
        eq(settingsHistory.area, area),
        eq(settingsHistory.targetId, targetId),
      ),
    )
    .orderBy(desc(settingsHistory.createdAt))
    .offset(MAX_PER_TARGET);
  if (old.length)
    await tx.delete(settingsHistory).where(
      inArray(
        settingsHistory.id,
        old.map((o) => o.id),
      ),
    );
}

/** Esegue una modifica di un pontile ricordando com'era prima e com'è dopo («Indietro» nella scheda del pontile). */
export async function withPierHistory<T>(
  tx: Tx,
  actor: HistoryActor,
  pierId: string,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const before = await snapshotPier(tx, actor.marinaId, pierId);
  const result = await fn();
  const after = await snapshotPier(tx, actor.marinaId, pierId);
  await record(tx, actor, "pontile", pierId, label, before, after);
  return result;
}

/** Esegue una modifica dei campi `keys` del porto ricordando com'erano prima e come sono dopo. */
export async function withMarinaHistory<T>(
  tx: Tx,
  actor: HistoryActor,
  label: string,
  keys: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const before = await snapshotMarina(tx, actor.marinaId, keys);
  const result = await fn();
  const after = await snapshotMarina(tx, actor.marinaId, keys);
  await record(tx, actor, "porto", actor.marinaId, label, before, after);
  return result;
}

async function current(
  tx: Tx,
  marinaId: string,
  area: HistoryArea,
  targetId: string,
  sample: unknown,
) {
  return area === "pontile"
    ? snapshotPier(tx, marinaId, targetId)
    : snapshotMarina(tx, marinaId, Object.keys(sample as object));
}

/**
 * «Indietro» (`redo` falso) o «Avanti»: rimette lo stato prima (o dopo) dell'ultima modifica, se da allora non è cambiato nulla.
 * Restituisce la descrizione della modifica.
 */
export async function stepHistory(
  tx: Tx,
  actor: HistoryActor,
  area: HistoryArea,
  targetId: string,
  redo: boolean,
): Promise<string> {
  const [entry] = await tx
    .select()
    .from(settingsHistory)
    .where(
      and(
        eq(settingsHistory.marinaId, actor.marinaId),
        eq(settingsHistory.area, area),
        eq(settingsHistory.targetId, targetId),
        eq(settingsHistory.undone, redo),
      ),
    )
    .orderBy(
      redo ? asc(settingsHistory.createdAt) : desc(settingsHistory.createdAt),
    )
    .limit(1)
    .for("update");
  if (!entry)
    throw new DomainError(
      redo ? "Non c'è niente da rifare." : "Non c'è niente da annullare.",
    );
  const expected = redo ? entry.before : entry.after;
  const now = await current(tx, actor.marinaId, area, targetId, entry.before);
  if (canonical(now) !== canonical(expected)) {
    throw new DomainError(
      `Dopo «${entry.label}» è cambiato qualcos'altro: non si può più ${redo ? "rifare" : "annullare"} da qui.`,
    );
  }
  const target = (redo ? entry.after : entry.before) as never;
  if (area === "pontile")
    await restorePier(tx, actor.marinaId, targetId, target);
  else await restoreMarina(tx, actor.marinaId, target);
  await tx
    .update(settingsHistory)
    .set({ undone: !redo })
    .where(eq(settingsHistory.id, entry.id));
  return entry.label;
}

/** Che cosa annullerebbe «Indietro» e che cosa rifarebbe «Avanti» (descrizioni), per i pulsanti. */
export interface HistoryState {
  undo: string | null;
  redo: string | null;
  /** Cambia a ogni modifica, annullamento o ripetizione: i moduli con i valori iniziali si ricaricano. */
  version: string;
}

export async function historyState(
  marinaId: string,
  area: HistoryArea,
  targetIds: string[],
): Promise<Record<string, HistoryState>> {
  if (targetIds.length === 0) return {};
  const rows = await db
    .select({
      id: settingsHistory.id,
      targetId: settingsHistory.targetId,
      label: settingsHistory.label,
      undone: settingsHistory.undone,
      createdAt: settingsHistory.createdAt,
    })
    .from(settingsHistory)
    .where(
      and(
        eq(settingsHistory.marinaId, marinaId),
        eq(settingsHistory.area, area),
        inArray(settingsHistory.targetId, targetIds),
      ),
    )
    .orderBy(asc(settingsHistory.createdAt));
  const out: Record<string, HistoryState> = {};
  for (const id of targetIds) {
    const mine = rows.filter((r) => r.targetId === id);
    const done = mine.filter((r) => !r.undone);
    const undone = mine.filter((r) => r.undone);
    out[id] = {
      undo: done.at(-1)?.label ?? null,
      redo: undone[0]?.label ?? null,
      version: `${mine.at(-1)?.id ?? "-"}:${undone.length}`,
    };
  }
  return out;
}
