"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { berths, boats, tasks } from "@/db/schema";
import { requireMarina } from "@/lib/context";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { recordMovement } from "./contracts";
import { toFormState } from "./errors";

const movementSchema = z.object({
  contractId: f.id(),
  kind: f.choice(["arrivo", "partenza", "uscita", "rientro"]),
  note: f.optText(),
});

// Arrivo, partenza, uscita in mare o rientro di una barca. Lo possono registrare tutti i ruoli.
export async function registerMovement(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina();
  const parsed = parseForm(movementSchema, formData);
  if (!parsed.ok) return parsed.state;
  try {
    await db.transaction((tx) =>
      recordMovement(tx, { marinaId: ctx.marinaId, userId: ctx.user.id }, parsed.data.contractId, parsed.data.kind, parsed.data.note),
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

const taskSchema = z.object({
  title: f.text("Scrivi di cosa si tratta"),
  kind: f.choice(["assistenza", "manutenzione", "segnalazione", "servizio"]),
  priority: f.choice(["bassa", "normale", "alta"]),
  berthId: f.optId(),
  boatId: f.optId(),
  description: f.optText(),
});

export async function createTask(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina();
  const parsed = parseForm(taskSchema, formData);
  if (!parsed.ok) return parsed.state;
  const data = parsed.data;

  // Posto e barca devono appartenere a questo porto.
  if (data.berthId) {
    const [b] = await db.select({ id: berths.id }).from(berths).where(and(eq(berths.id, data.berthId), eq(berths.marinaId, ctx.marinaId))).limit(1);
    if (!b) return fail("Posto barca non trovato.", { berthId: "Posto barca non trovato." });
  }
  if (data.boatId) {
    const [b] = await db.select({ id: boats.id }).from(boats).where(and(eq(boats.id, data.boatId), eq(boats.marinaId, ctx.marinaId))).limit(1);
    if (!b) return fail("Barca non trovata.", { boatId: "Barca non trovata." });
  }

  await db.insert(tasks).values({ marinaId: ctx.marinaId, createdBy: ctx.user.id, ...data });
  revalidatePath("/", "layout");
  return { ok: true, message: "Segnalazione registrata." };
}

const taskStatusSchema = z.object({
  taskId: f.id(),
  status: f.choice(["aperta", "in_corso", "chiusa"]),
  resolution: f.optText(),
});

export async function setTaskStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina();
  const parsed = parseForm(taskStatusSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { taskId, status, resolution } = parsed.data;
  const closed = status === "chiusa";
  const updated = await db
    .update(tasks)
    .set({ status, closedAt: closed ? new Date() : null, closedBy: closed ? ctx.user.id : null, resolution: closed ? resolution : null })
    .where(and(eq(tasks.id, taskId), eq(tasks.marinaId, ctx.marinaId)))
    .returning({ id: tasks.id });
  if (updated.length === 0) return fail("Segnalazione non trovata.");
  revalidatePath("/", "layout");
  return { ok: true };
}
