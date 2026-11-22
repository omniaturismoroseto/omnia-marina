"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { boats, charges, contracts, marinas, ownerAccess, ownerInvites, owners, privacyConsents } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { f, fail, formId, parseForm, type FormState } from "@/lib/forms";
import { toFormState } from "./errors";
import { setOwnerFormer } from "./owners";

const ownerSchema = z
  .object({
    id: f.optId(),
    type: f.choice(["persona", "azienda"]),
    firstName: f.optText(),
    lastName: f.optText(),
    companyName: f.optText(),
    fiscalCode: f.optText(),
    vatNumber: f.optText(),
    birthDate: f.optDate(),
    birthPlace: f.optText(),
    address: f.optText(),
    zip: f.optText(),
    city: f.optText(),
    province: f.optText(),
    country: f.optText(),
    phone: f.optText(),
    email: f.optEmail(),
    pec: f.optEmail(),
    sdiCode: f.optText(),
    idDocType: f.optText(),
    idDocNumber: f.optText(),
    idDocExpiry: f.optDate(),
    notes: f.optText(),
    consentInformativa: f.checkbox(),
    consentMarketing: f.checkbox(),
    consentTerzi: f.checkbox(),
    consentMethod: z.preprocess((v) => (typeof v === "string" && v ? v : "cartaceo"), z.enum(["cartaceo", "digitale", "verbale"])),
  })
  .superRefine((data, ctx) => {
    if (data.type === "persona") {
      if (!data.lastName) ctx.addIssue({ code: "custom", path: ["lastName"], message: "Campo obbligatorio" });
      if (!data.firstName) ctx.addIssue({ code: "custom", path: ["firstName"], message: "Campo obbligatorio" });
    } else if (!data.companyName) {
      ctx.addIssue({ code: "custom", path: ["companyName"], message: "Campo obbligatorio" });
    }
  });

export async function saveOwner(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(ownerSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { id, consentInformativa, consentMarketing, consentTerzi, consentMethod, ...data } = parsed.data;

  const person = data.type === "persona";
  const values = {
    ...data,
    firstName: person ? data.firstName : null,
    lastName: person ? data.lastName : null,
    companyName: person ? null : data.companyName,
    birthDate: person ? data.birthDate : null,
    birthPlace: person ? data.birthPlace : null,
    displayName: person ? `${data.lastName} ${data.firstName}` : data.companyName!,
    fiscalCode: data.fiscalCode?.toUpperCase() ?? null,
    province: data.province?.toUpperCase() ?? null,
    country: data.country ?? "Italia",
  };

  let ownerId: string;
  if (id) {
    const updated = await db
      .update(owners)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(owners.id, id), eq(owners.marinaId, ctx.marinaId), sql`${owners.anonymizedAt} is null`))
      .returning({ id: owners.id });
    if (updated.length === 0) return fail("Cliente non trovato.");
    ownerId = id;
    await audit(ctx, "modifica", "cliente", ownerId, values.displayName);
  } else {
    ownerId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(owners)
        .values({ marinaId: ctx.marinaId, ...values })
        .returning({ id: owners.id });
      const [marina] = await tx.select({ version: marinas.privacyPolicyVersion }).from(marinas).where(eq(marinas.id, ctx.marinaId));
      const kinds = [
        consentInformativa ? ("informativa" as const) : null,
        consentMarketing ? ("marketing" as const) : null,
        consentTerzi ? ("terzi" as const) : null,
      ].filter((k) => k !== null);
      if (kinds.length > 0) {
        await tx.insert(privacyConsents).values(
          kinds.map((kind) => ({
            marinaId: ctx.marinaId,
            ownerId: created.id,
            kind,
            granted: true,
            policyVersion: marina.version,
            method: consentMethod,
            recordedBy: ctx.user.id,
          })),
        );
      }
      await audit(ctx, "creazione", "cliente", created.id, values.displayName, tx);
      return created.id;
    });
  }

  revalidatePath("/", "layout");
  redirect(`/clienti/${ownerId}`);
}

const consentSchema = z.object({
  ownerId: f.id(),
  kind: f.choice(["informativa", "marketing", "terzi"]),
  granted: f.choice(["true", "false"]),
  method: f.choice(["cartaceo", "digitale", "verbale"]),
  note: f.optText(),
});

// Aggiunge una riga al registro dei consensi (concessione o revoca). Le righe non si modificano.
export async function recordConsent(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const parsed = parseForm(consentSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { ownerId, kind, granted, method, note } = parsed.data;

  const [owner] = await db
    .select({ id: owners.id })
    .from(owners)
    .where(and(eq(owners.id, ownerId), eq(owners.marinaId, ctx.marinaId)))
    .limit(1);
  if (!owner) return fail("Cliente non trovato.");
  const [marina] = await db.select({ version: marinas.privacyPolicyVersion }).from(marinas).where(eq(marinas.id, ctx.marinaId));

  await db.insert(privacyConsents).values({
    marinaId: ctx.marinaId,
    ownerId,
    kind,
    granted: granted === "true",
    policyVersion: marina.version,
    method,
    note,
    recordedBy: ctx.user.id,
  });
  await audit(ctx, granted === "true" ? "consenso" : "revoca consenso", "cliente", ownerId, kind);
  revalidatePath("/", "layout");
  return { ok: true, message: "Registrato." };
}

/**
 * Diritto alla cancellazione.
 * - Cliente senza barche, contratti o addebiti: viene eliminato del tutto.
 * - Cliente con storico: i dati personali vengono sostituiti da un segnaposto, mentre contratti
 *   e movimenti contabili restano (vanno conservati per legge) ma non sono più riconducibili a lui.
 * Non è possibile finché ci sono contratti attivi o importi da incassare.
 */
export async function eraseOwner(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(["admin"]);
  const ownerId = formId(formData, "ownerId");
  if (!ownerId) return fail("Cliente non trovato.");
  const [owner] = await db
    .select()
    .from(owners)
    .where(and(eq(owners.id, ownerId), eq(owners.marinaId, ctx.marinaId)))
    .limit(1);
  if (!owner) return fail("Cliente non trovato.");

  const [{ boatCount }] = await db.select({ boatCount: sql<number>`count(*)::int` }).from(boats).where(eq(boats.ownerId, ownerId));
  const [{ contractCount }] = await db.select({ contractCount: sql<number>`count(*)::int` }).from(contracts).where(eq(contracts.ownerId, ownerId));
  const [{ chargeCount }] = await db.select({ chargeCount: sql<number>`count(*)::int` }).from(charges).where(eq(charges.ownerId, ownerId));

  if (boatCount + contractCount + chargeCount === 0) {
    await db.transaction(async (tx) => {
      await tx.delete(owners).where(eq(owners.id, ownerId));
      await audit(ctx, "eliminazione", "cliente", ownerId, "Cliente senza storico eliminato", tx);
    });
    revalidatePath("/", "layout");
    redirect("/clienti");
  }

  const [{ live }] = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(contracts)
    .where(and(eq(contracts.ownerId, ownerId), inArray(contracts.status, ["attivo", "bozza"])));
  if (live > 0) return fail("Il cliente ha contratti attivi o in bozza: chiudili o annullali prima di procedere.");

  const [{ open }] = await db
    .select({
      open: sql<number>`coalesce(sum(${charges.grossCents} - (select coalesce(sum(p.amount_cents), 0) from payments p where p.charge_id = "charges"."id")), 0)::int`,
    })
    .from(charges)
    .where(and(eq(charges.ownerId, ownerId), sql`${charges.cancelledAt} is null`));
  if (open > 0) return fail("Il cliente ha importi ancora da incassare: salda o annulla gli addebiti prima di procedere.");

  await db.transaction(async (tx) => {
    await tx
      .update(owners)
      .set({
        firstName: null,
        lastName: null,
        companyName: null,
        displayName: `Cliente anonimizzato ${ownerId.slice(0, 8)}`,
        fiscalCode: null,
        vatNumber: null,
        birthDate: null,
        birthPlace: null,
        address: null,
        zip: null,
        city: null,
        province: null,
        phone: null,
        email: null,
        pec: null,
        sdiCode: null,
        idDocType: null,
        idDocNumber: null,
        idDocExpiry: null,
        notes: null,
        anonymizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(owners.id, ownerId));
    await tx
      .update(boats)
      .set({ registration: null, insuranceCompany: null, insurancePolicy: null, insuranceExpiry: null, notes: null, updatedAt: new Date() })
      .where(eq(boats.ownerId, ownerId));
    await tx.update(contracts).set({ notes: null }).where(eq(contracts.ownerId, ownerId));
    // Niente più accessi all'area diportista: con l'accesso se ne vanno anche le sessioni aperte.
    await tx.delete(ownerInvites).where(eq(ownerInvites.ownerId, ownerId));
    await tx.delete(ownerAccess).where(eq(ownerAccess.ownerId, ownerId));
    await audit(ctx, "anonimizzazione", "cliente", ownerId, "Dati personali rimossi su richiesta", tx);
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

// Spunta o toglie la categoria «Ex cliente» (nome scelto dalla direzione in Impostazioni → Porto).
export async function setOwnerFormerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const ownerId = formId(formData, "ownerId");
  if (!ownerId) return fail("Cliente non trovato.");
  const former = formData.get("former") === "1";
  try {
    await db.transaction(async (tx) => {
      await setOwnerFormer(tx, ctx.marinaId, ownerId, former);
      await audit(ctx, "modifica", "cliente", ownerId, former ? "Spostato nella categoria ex clienti" : "Tolto dalla categoria ex clienti", tx);
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
