"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { contractItems, marinas, parkingSpaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { isValidISODate } from "@/lib/dates";
import { f, fail, formId, parseForm, type FormState } from "@/lib/forms";
import { nextParkingCode } from "@/lib/parking-codes";
import { parkingOptions, type ParkingOption } from "./parking";

// Posti auto della mappa (Impostazioni → Posti auto): li gestisce la direzione; l'ufficio li sceglie nei contratti.
const ADMIN = ["admin" as const];
const MAX_AT_ONCE = 300;

const createSchema = z.object({
  prefix: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : ""), z.string().max(6, "Al massimo 6 caratteri").regex(/^[A-Z0-9]*$/, "Solo lettere e cifre")),
  from: f.int(0, 9999),
  to: f.int(0, 9999),
  covered: f.choice(["coperto", "scoperto"]),
  lengthCm: f.meters(),
  widthCm: f.meters(),
});

/** Crea in blocco i posti auto da «P1» a «P20» (sigla e numeri a scelta); salta i codici che esistono già. */
export async function createParkingSpaces(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(createSchema, formData);
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  if (d.to < d.from) return fail("Controlla i campi evidenziati.", { to: "Deve essere almeno il primo numero" });
  if (d.to - d.from + 1 > MAX_AT_ONCE) return fail(`Al massimo ${MAX_AT_ONCE} posti auto per volta.`);
  const codes = Array.from({ length: d.to - d.from + 1 }, (_, i) => `${d.prefix}${d.from + i}`);
  const existing = await db
    .select({ code: parkingSpaces.code })
    .from(parkingSpaces)
    .where(and(eq(parkingSpaces.marinaId, ctx.marinaId), inArray(parkingSpaces.code, codes)));
  const taken = new Set(existing.map((r) => r.code));
  const fresh = codes.filter((c) => !taken.has(c));
  if (fresh.length === 0) return fail("Questi posti auto esistono già.");
  await db.transaction(async (tx) => {
    await tx.insert(parkingSpaces).values(
      fresh.map((code) => ({ marinaId: ctx.marinaId, code, covered: d.covered === "coperto", lengthCm: d.lengthCm, widthCm: d.widthCm })),
    );
    await audit(ctx, "creazione", "posti auto", ctx.marinaId, `${fresh.length} posti auto ${d.covered} (${fresh[0]}–${fresh[fresh.length - 1]})`, tx);
  });
  revalidatePath("/", "layout");
  const skipped = taken.size ? ` ${taken.size} ${taken.size === 1 ? "c'era già ed è stato saltato" : "c'erano già e sono stati saltati"}.` : "";
  return { ok: true, message: `Creati ${fresh.length} posti auto: ${fresh[0]}–${fresh[fresh.length - 1]}. Ora disponili sulla mappa.${skipped}` };
}

const updateSchema = z.object({
  id: f.id(),
  code: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : ""), z.string().min(1, "Indica il codice").max(12)),
  covered: f.choice(["coperto", "scoperto"]),
  lengthCm: f.meters(),
  widthCm: f.meters(),
  active: f.checkbox(),
  notes: f.optText(),
});

export async function updateParkingSpace(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(updateSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { id, covered, ...d } = parsed.data;
  const [current] = await db.select().from(parkingSpaces).where(and(eq(parkingSpaces.id, id), eq(parkingSpaces.marinaId, ctx.marinaId)));
  if (!current) return fail("Posto auto non trovato.");
  // Coperto o scoperto decide in quale voce del contratto si sceglie: se è già in un contratto non cambia.
  if ((covered === "coperto") !== current.covered) {
    const [used] = await db.select({ id: contractItems.id }).from(contractItems).where(eq(contractItems.parkingSpaceId, id)).limit(1);
    if (used) return fail("Il posto auto è già in un contratto: non può passare da coperto a scoperto (o viceversa).", { covered: "Già in un contratto" });
  }
  try {
    await db
      .update(parkingSpaces)
      .set({ ...d, covered: covered === "coperto" })
      .where(and(eq(parkingSpaces.id, id), eq(parkingSpaces.marinaId, ctx.marinaId)));
  } catch {
    return fail("Esiste già un posto auto con questo codice.", { code: "Codice già usato" });
  }
  await audit(ctx, "modifica", "posto auto", id, d.code);
  revalidatePath("/", "layout");
  return { ok: true, message: `Posto auto ${d.code} salvato.` };
}

export async function deleteParkingSpace(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const id = formId(formData, "id");
  if (!id) return fail("Posto auto non trovato.");
  const [used] = await db.select({ id: contractItems.id }).from(contractItems).where(eq(contractItems.parkingSpaceId, id)).limit(1);
  if (used) return fail("Il posto auto è in un contratto e non si può eliminare: mettilo fuori servizio.");
  const deleted = await db
    .delete(parkingSpaces)
    .where(and(eq(parkingSpaces.id, id), eq(parkingSpaces.marinaId, ctx.marinaId)))
    .returning({ code: parkingSpaces.code });
  if (deleted.length === 0) return fail("Posto auto non trovato.");
  await audit(ctx, "eliminazione", "posto auto", id, deleted[0].code);
  revalidatePath("/", "layout");
  return { ok: true, message: `Posto auto ${deleted[0].code} eliminato.` };
}

const layoutSchema = z.object({
  placements: z
    .array(
      z.object({
        id: z.uuid(),
        position: z.object({ x: z.number().finite(), y: z.number().finite(), angle: z.number().finite() }).nullable(),
      }),
    )
    .max(5000),
});

type Placements = z.infer<typeof layoutSchema>["placements"];

/** Controlla e scrive le posizioni dei posti auto (solo del porto); un messaggio se qualcosa non va. */
async function writeLayout(tx: Tx | typeof db, marinaId: string, placements: Placements): Promise<string | null> {
  const [marina] = await tx.select({ width: marinas.planWidth, height: marinas.planHeight }).from(marinas).where(eq(marinas.id, marinaId));
  if (!marina?.width || !marina.height) return "Carica prima la foto del porto.";
  const margin = 0.1;
  const inside = (p: { x: number; y: number }) =>
    p.x >= -marina.width! * margin && p.x <= marina.width! * (1 + margin) && p.y >= -marina.height! * margin && p.y <= marina.height! * (1 + margin);
  if (placements.some((p) => p.position && !inside(p.position))) return "Alcuni posti auto sono fuori dalla foto.";
  if (placements.length > 0) {
    const rows = sql.join(
      placements.map((p) => sql`(${p.id}::uuid, ${p.position?.x ?? null}::real, ${p.position?.y ?? null}::real, ${p.position?.angle ?? null}::real)`),
      sql`, `,
    );
    // Il filtro sul porto impedisce di spostare posti auto di altri porti.
    await tx.execute(sql`
      update parking_spaces set plan_x = v.x, plan_y = v.y, plan_angle = v.angle
      from (values ${rows}) as v(id, x, y, angle)
      where parking_spaces.id = v.id and parking_spaces.marina_id = ${marinaId}
    `);
  }
  return null;
}

/** Salva le posizioni dei posti auto sulla mappa (in pixel della foto, come i posti barca). */
export async function saveParkingLayout(input: z.input<typeof layoutSchema>): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireMarina(ADMIN);
  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dati della mappa non validi." };
  const problem = await writeLayout(db, ctx.marinaId, parsed.data.placements);
  if (problem) return { ok: false, message: problem };
  await audit(ctx, "modifica", "posti auto", ctx.marinaId, `Posizioni sulla mappa di ${parsed.data.placements.length} posti auto`);
  revalidatePath("/", "layout");
  return { ok: true, message: "Posti auto salvati sulla mappa." };
}

const addSchema = layoutSchema.extend({
  afterId: z.uuid(),
  position: z.object({ x: z.number().finite(), y: z.number().finite(), angle: z.number().finite() }),
});

/**
 * «Aggiungi un posto» a una fila già sulla mappa: salva le posizioni dell'editor e crea il posto successivo a `afterId` (stesso tipo e
 * misure, codice successivo) nella posizione calcolata dall'editor, in fondo alla fila.
 */
export async function addParkingToRow(input: z.input<typeof addSchema>): Promise<{ ok: boolean; message: string; id?: string }> {
  const ctx = await requireMarina(ADMIN);
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dati della mappa non validi." };
  const { placements, afterId, position } = parsed.data;
  try {
    const code = await db.transaction(async (tx) => {
      const problem = await writeLayout(tx, ctx.marinaId, placements);
      if (problem) throw new Error(problem);
      const [after] = await tx.select().from(parkingSpaces).where(and(eq(parkingSpaces.id, afterId), eq(parkingSpaces.marinaId, ctx.marinaId)));
      if (!after) throw new Error("Posto auto non trovato.");
      const taken = new Set((await tx.select({ code: parkingSpaces.code }).from(parkingSpaces).where(eq(parkingSpaces.marinaId, ctx.marinaId))).map((r) => r.code.toUpperCase()));
      const next = nextParkingCode(after.code, taken);
      const [created] = await tx.insert(parkingSpaces).values({
        marinaId: ctx.marinaId,
        code: next,
        covered: after.covered,
        lengthCm: after.lengthCm,
        widthCm: after.widthCm,
        planX: position.x,
        planY: position.y,
        planAngle: position.angle,
      }).returning({ id: parkingSpaces.id });
      await audit(ctx, "creazione", "posto auto", ctx.marinaId, `${next} aggiunto in fila dopo ${after.code}`, tx);
      return { next, id: created.id };
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Aggiunto il posto auto ${code.next} in fondo alla fila.`, id: code.id };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Posto auto non aggiunto." };
  }
}

const removeSchema = layoutSchema.extend({ id: z.uuid() });

/** «Togli» un posto dalla fila: salva le posizioni dell'editor ed elimina il posto auto, se non è mai stato in un contratto. */
export async function removeParkingFromRow(input: z.input<typeof removeSchema>): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireMarina(ADMIN);
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dati della mappa non validi." };
  const { placements, id } = parsed.data;
  const [used] = await db.select({ id: contractItems.id }).from(contractItems).where(eq(contractItems.parkingSpaceId, id)).limit(1);
  if (used) return { ok: false, message: "Questo posto auto è in un contratto e non si può eliminare: mettilo fuori servizio (toccalo nell'elenco qui sopra)." };
  try {
    const code = await db.transaction(async (tx) => {
      const problem = await writeLayout(tx, ctx.marinaId, placements.filter((p) => p.id !== id));
      if (problem) throw new Error(problem);
      const deleted = await tx
        .delete(parkingSpaces)
        .where(and(eq(parkingSpaces.id, id), eq(parkingSpaces.marinaId, ctx.marinaId)))
        .returning({ code: parkingSpaces.code });
      if (deleted.length === 0) throw new Error("Posto auto non trovato.");
      await audit(ctx, "eliminazione", "posto auto", id, `${deleted[0].code} tolto dalla fila`, tx);
      return deleted[0].code;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Posto auto ${code} tolto.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Posto auto non tolto." };
  }
}

/** Posti auto con chi li ha nel periodo, per sceglierli in un contratto (escluso il contratto stesso, se c'è). */
export async function parkingOptionsAction(input: { from: string; to: string; contractId?: string | null }): Promise<ParkingOption[]> {
  const ctx = await requireMarina(OFFICE);
  if (!isValidISODate(input.from) || !isValidISODate(input.to) || input.to < input.from) return [];
  const contractId = input.contractId && z.uuid().safeParse(input.contractId).success ? input.contractId : null;
  return parkingOptions(ctx.marinaId, input.from, input.to, contractId);
}
