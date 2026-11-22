"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { fail, formId, type FormState } from "@/lib/forms";
import { MAX_OWNER_IMPORT_ROWS } from "@/lib/owner-import";
import { toFormState } from "./errors";
import { findExistingOwners, importOwners, undoOwnerImport, type ExistingOwner } from "./owner-import";

const str = (max: number) => z.string().max(max);
const date = z.union([z.literal(""), z.iso.date()]);
const int = (max: number) => z.number().int().min(0).max(max).nullable();

const ownerSchema = z.object({
  type: z.enum(["persona", "azienda"]),
  firstName: str(120),
  lastName: str(120),
  companyName: str(200),
  fiscalCode: str(32),
  vatNumber: str(32),
  birthDate: date,
  birthPlace: str(120),
  address: str(300),
  zip: str(16),
  city: str(120),
  province: str(40),
  country: str(80),
  phone: str(120),
  email: str(200),
  pec: str(200),
  sdiCode: str(16),
  notes: str(2000),
});

const boatSchema = z.object({
  name: str(160),
  registration: str(60),
  type: z.enum(["vela", "motore", "gommone", "catamarano", "altro"]),
  builder: str(120),
  model: str(120),
  year: int(2200),
  lengthCm: int(20000),
  beamCm: int(5000),
  draftCm: int(3000),
  flag: str(40),
  engineType: str(60),
  engineBrand: str(80),
  engineCount: int(20),
  enginePowerHp: int(20000),
  auxEngineType: str(60),
  auxEngineBrand: str(80),
  auxEngineCount: int(20),
  auxEnginePowerHp: int(20000),
  declaredValueCents: int(100_000_000_000),
  insuranceCompany: str(160),
  insurancePolicy: str(80),
  insuranceExpiry: date,
});

const payloadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  sheetName: z.string().max(200),
  markFormer: z.boolean(),
  decisions: z.record(z.string().max(300), z.enum(["crea", "completa", "salta"])),
  rows: z
    .array(z.object({ row: z.number().int().positive(), excluded: z.boolean(), owner: ownerSchema, boat: boatSchema.nullable() }))
    .min(1)
    .max(MAX_OWNER_IMPORT_ROWS),
});

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const matchSchema = z
  .array(z.object({ key: z.string().max(300), fiscalCode: z.string().max(32), vatNumber: z.string().max(32), name: z.string().max(300) }))
  .max(MAX_OWNER_IMPORT_ROWS);

/** Anteprima: quali clienti del file esistono già nel porto (stesso codice fiscale, partita IVA o nome). */
export async function matchExistingOwners(queries: unknown): Promise<Record<string, ExistingOwner>> {
  const ctx = await requireMarina(OFFICE);
  const parsed = matchSchema.safeParse(queries);
  if (!parsed.success) return {};
  return findExistingOwners(ctx.marinaId, parsed.data);
}

// Importa clienti e barche controllati nell'anteprima. I controlli bloccanti si ripetono qui: il browser
// manda le righe, il server decide che cosa salvare.
export async function importOwnersFile(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return fail("Dati dell'anteprima non leggibili: ricarica il file.");
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return fail("Dati dell'anteprima non validi: ricarica il file.");
  const input = parsed.data;
  let message = "";
  try {
    await db.transaction(async (tx) => {
      const r = await importOwners(tx, { marinaId: ctx.marinaId, userId: ctx.user.id }, input);
      const summary = [
        count(r.ownersCreated, "cliente nuovo", "clienti nuovi"),
        r.ownersMatched ? `${count(r.ownersMatched, "già presente", "già presenti")} (${r.ownersUpdated ? `${count(r.ownersUpdated, "completato", "completati")} con dati nuovi` : "nessun dato nuovo"})` : "",
        r.ownersSkipped ? count(r.ownersSkipped, "saltato", "saltati") : "",
        count(r.boatsCreated, "barca", "barche"),
        r.boatsSkipped ? `${count(r.boatsSkipped, "barca non creata", "barche non create")} (senza misure o già presenti)` : "",
      ]
        .filter(Boolean)
        .join(", ");
      await audit(ctx, "importazione", "clienti", r.importId, `${input.fileName} · ${summary}`, tx);
      message = `Importazione completata: ${summary}.`;
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  return { ok: true, message };
}

export async function removeOwnerImport(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const importId = formId(formData, "importId");
  if (!importId) return fail("Importazione non trovata.");
  let message = "";
  try {
    await db.transaction(async (tx) => {
      const r = await undoOwnerImport(tx, { marinaId: ctx.marinaId, userId: ctx.user.id }, importId);
      const kept = r.ownersKept + r.boatsKept;
      message = `Importazione annullata: tolti ${count(r.ownersDeleted, "cliente", "clienti")} e ${count(r.boatsDeleted, "barca", "barche")}.${kept ? ` Restano ${count(r.ownersKept, "cliente", "clienti")} e ${count(r.boatsKept, "barca", "barche")} già usati in contratti, addebiti o consensi.` : ""}`;
      await audit(ctx, "annullamento importazione", "clienti", importId, `${r.fileName} · ${message}`, tx);
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  return { ok: true, message };
}
