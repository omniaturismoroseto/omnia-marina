"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { boats, owners } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { toFormState } from "./errors";

const boatSchema = z.object({
  id: f.optId(),
  ownerId: f.id("Scegli il proprietario"),
  name: f.text("Inserisci il nome della barca"),
  registration: f.optText(),
  type: f.choice(["vela", "motore", "gommone", "catamarano", "altro"]),
  builder: f.optText(),
  model: f.optText(),
  year: f.optInt(1900, 2100, "Anno non valido"),
  lengthCm: f.meters(),
  beamCm: f.meters(),
  draftCm: f.optMeters(),
  flag: f.optText(),
  engine: f.optText(),
  insuranceCompany: f.optText(),
  insurancePolicy: f.optText(),
  insuranceExpiry: f.optDate(),
  notes: f.optText(),
});

export async function saveBoat(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(boatSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { id, ...data } = parsed.data;

  const [owner] = await db
    .select({ id: owners.id })
    .from(owners)
    .where(and(eq(owners.id, data.ownerId), eq(owners.marinaId, ctx.marinaId)))
    .limit(1);
  if (!owner) return fail("Controlla i campi evidenziati.", { ownerId: "Cliente non trovato." });

  let boatId: string;
  if (id) {
    const updated = await db
      .update(boats)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(boats.id, id), eq(boats.marinaId, ctx.marinaId)))
      .returning({ id: boats.id });
    if (updated.length === 0) return fail("Barca non trovata.");
    boatId = id;
    await audit(ctx, "modifica", "barca", boatId, data.name);
  } else {
    const [created] = await db
      .insert(boats)
      .values({ marinaId: ctx.marinaId, ...data })
      .returning({ id: boats.id });
    boatId = created.id;
    await audit(ctx, "creazione", "barca", boatId, data.name);
  }

  revalidatePath("/", "layout");
  redirect(`/barche/${boatId}`);
}

export async function deleteBoat(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const boatId = String(formData.get("boatId") ?? "");
  try {
    const deleted = await db
      .delete(boats)
      .where(and(eq(boats.id, boatId), eq(boats.marinaId, ctx.marinaId)))
      .returning({ name: boats.name, ownerId: boats.ownerId });
    if (deleted.length === 0) return fail("Barca non trovata.");
    await audit(ctx, "eliminazione", "barca", boatId, deleted[0].name);
  } catch (err) {
    const state = toFormState(err);
    return { ...state, message: "La barca ha contratti collegati e non può essere eliminata." };
  }
  revalidatePath("/", "layout");
  redirect("/barche");
}
