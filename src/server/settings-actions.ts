"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { berthCategories, berths, marinas, memberships, piers, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMarina, requireUser } from "@/lib/context";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { ROLE_LABEL } from "@/lib/labels";
import { berthSlots } from "@/lib/plan";
import { parseCoordinates } from "@/lib/weather";
import { checkPassword, createAccount, setPassword } from "./credentials";
import { toFormState } from "./errors";

const ACCOUNT_SERVICE_DOWN = "Il servizio di accesso non risponde: riprova tra qualche minuto.";

const ADMIN = ["admin" as const];
const password = (message = "Almeno 10 caratteri") => z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().min(10, message).max(200));

// ───────────────────────── Porto ─────────────────────────

const marinaSchema = z.object({
  name: f.text("Inserisci il nome del porto"),
  legalName: f.optText(),
  vatNumber: f.optText(),
  fiscalCode: f.optText(),
  address: f.optText(),
  zip: f.optText(),
  city: f.optText(),
  province: f.optText(),
  phone: f.optText(),
  email: f.optEmail(),
  vhfChannel: f.optText(),
  defaultVatRate: f.int(0, 30, "Aliquota non valida"),
  serviceFeeCents: f.optMoney(),
  wasteFeeCents: f.optMoney(),
  formerOwnerLabel: f.text("Dai un nome alla categoria"),
});

export async function saveMarina(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(marinaSchema, formData);
  if (!parsed.ok) return parsed.state;
  await db
    .update(marinas)
    .set({ ...parsed.data, province: parsed.data.province?.toUpperCase() ?? null })
    .where(eq(marinas.id, ctx.marinaId));
  await audit(ctx, "modifica", "porto", ctx.marinaId, "Dati del porto");
  revalidatePath("/", "layout");
  return { ok: true, message: "Dati salvati." };
}

const boaterSettingsSchema = z.object({
  officeHours: f.optText(),
  boaterInfo: f.optText(),
  coordinates: f.optText(),
  windAlertKnots: f.int(10, 80, "Scegli una soglia tra 10 e 80 nodi"),
  windAlertAuto: f.checkbox(),
});

// Area diportisti e meteo: orari, informazioni utili, posizione del porto e allerta vento.
export async function saveBoaterSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(boaterSettingsSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { coordinates, ...data } = parsed.data;
  const position = coordinates ? parseCoordinates(coordinates) : null;
  if (coordinates && !position) {
    return fail("Controlla i campi evidenziati.", { coordinates: "Scrivi latitudine e longitudine, per esempio 42.6589, 14.0256" });
  }
  await db
    .update(marinas)
    .set({ ...data, latitude: position?.latitude ?? null, longitude: position?.longitude ?? null })
    .where(eq(marinas.id, ctx.marinaId));
  await audit(ctx, "modifica", "porto", ctx.marinaId, "Area diportisti e meteo");
  revalidatePath("/", "layout");
  return { ok: true, message: "Impostazioni salvate." };
}

const textsSchema = z.object({
  privacyPolicyVersion: f.text("Indica la versione"),
  privacyPolicyText: f.optText(),
  contractTerms: f.optText(),
  contractApprovalText: f.optText(),
});

export async function saveLegalTexts(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(textsSchema, formData);
  if (!parsed.ok) return parsed.state;
  await db.update(marinas).set(parsed.data).where(eq(marinas.id, ctx.marinaId));
  await audit(ctx, "modifica", "porto", ctx.marinaId, `Testi di privacy e contratto (informativa v. ${parsed.data.privacyPolicyVersion})`);
  revalidatePath("/", "layout");
  return { ok: true, message: "Testi salvati." };
}

// ───────────────────────── Pontili e posti ─────────────────────────

const pierSchema = z.object({
  id: f.optId(),
  code: f.text("Indica una sigla"),
  name: f.text("Indica il nome"),
  sortOrder: f.int(0, 999, "Numero non valido"),
});

export async function savePier(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(pierSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { id, ...data } = parsed.data;
  data.code = data.code.toUpperCase();
  try {
    if (id) {
      const updated = await db
        .update(piers)
        .set(data)
        .where(and(eq(piers.id, id), eq(piers.marinaId, ctx.marinaId)))
        .returning({ id: piers.id });
      if (updated.length === 0) return fail("Pontile non trovato.");
    } else {
      await db.insert(piers).values({ marinaId: ctx.marinaId, ...data });
    }
  } catch (err) {
    const state = toFormState(err);
    return { ...state, message: "Esiste già un pontile con questa sigla.", errors: { code: "Sigla già usata" } };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: id ? "Salvato." : "Pontile aggiunto." };
}

export async function deletePier(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const pierId = String(formData.get("pierId") ?? "");
  try {
    const deleted = await db
      .delete(piers)
      .where(and(eq(piers.id, pierId), eq(piers.marinaId, ctx.marinaId)))
      .returning({ name: piers.name });
    if (deleted.length === 0) return fail("Pontile non trovato.");
    await audit(ctx, "eliminazione", "pontile", pierId, deleted[0].name);
  } catch (err) {
    return { ...toFormState(err), message: "Il pontile ha posti con contratti collegati e non può essere eliminato." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

const generateSchema = z.object({
  pierId: f.id(),
  prefix: f.text("Indica il prefisso"),
  from: f.int(1, 999, "Numero non valido"),
  to: f.int(1, 999, "Numero non valido"),
  layout: f.choice(["alternati", "sx", "dx"]),
  categoryId: f.id("Scegli la categoria"),
  draftCm: f.optMeters(),
  hasWater: f.checkbox(),
  hasPower: f.checkbox(),
});

// Crea in blocco i posti di un pontile (es. da A01 ad A20), con le misure della categoria scelta.
export async function generateBerths(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(generateSchema, formData);
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  if (d.to < d.from) return fail("Controlla i campi evidenziati.", { to: "Deve essere maggiore o uguale al primo numero." });
  if (d.to - d.from >= 200) return fail("Controlla i campi evidenziati.", { to: "Al massimo 200 posti per volta." });

  const [pier] = await db
    .select({ id: piers.id })
    .from(piers)
    .where(and(eq(piers.id, d.pierId), eq(piers.marinaId, ctx.marinaId)))
    .limit(1);
  const [category] = await db
    .select()
    .from(berthCategories)
    .where(and(eq(berthCategories.id, d.categoryId), eq(berthCategories.marinaId, ctx.marinaId)))
    .limit(1);
  if (!pier) return fail("Pontile non trovato.");
  if (!category) return fail("Controlla i campi evidenziati.", { categoryId: "Categoria non trovata." });

  // I nuovi posti proseguono dopo quelli già presenti sullo stesso lato (vedi berthSlots).
  const [{ nextSx, nextDx }] = await db
    .select({
      nextSx: sql<number>`coalesce(max(${berths.position}) filter (where ${berths.side} = 'sx') + 1, 0)::int`,
      nextDx: sql<number>`coalesce(max(${berths.position}) filter (where ${berths.side} = 'dx') + 1, 0)::int`,
    })
    .from(berths)
    .where(eq(berths.pierId, pier.id));

  const prefix = d.prefix.toUpperCase();
  const slots = berthSlots(d.layout, d.to - d.from + 1, nextSx, nextDx);
  const values = slots.map((slot, i) => ({
    marinaId: ctx.marinaId,
    pierId: pier.id,
    categoryId: category.id,
    code: `${prefix}${String(d.from + i).padStart(2, "0")}`,
    side: slot.side,
    position: slot.position,
    lengthCm: category.maxLengthCm,
    beamCm: category.maxBeamCm,
    draftCm: d.draftCm,
    hasWater: d.hasWater,
    hasPower: d.hasPower,
  }));

  const created = await db.insert(berths).values(values).onConflictDoNothing().returning({ id: berths.id });
  await audit(ctx, "creazione", "posti barca", pier.id, `${created.length} posti (${values[0].code}–${values[values.length - 1].code})`);
  revalidatePath("/", "layout");
  const skipped = values.length - created.length;
  return { ok: true, message: `${created.length} posti creati${skipped > 0 ? `, ${skipped} già esistenti saltati` : ""}.` };
}

const berthSchema = z.object({
  id: f.id(),
  code: f.text("Indica il codice"),
  categoryId: f.optId(),
  side: f.choice(["sx", "dx"]),
  position: f.int(0, 999, "Numero non valido"),
  lengthCm: f.meters(),
  beamCm: f.meters(),
  draftCm: f.optMeters(),
  hasWater: f.checkbox(),
  hasPower: f.checkbox(),
  status: f.choice(["attivo", "manutenzione", "fuori_servizio"]),
  notes: f.optText(),
});

export async function saveBerth(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(berthSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { id, ...data } = parsed.data;
  data.code = data.code.toUpperCase();
  if (data.categoryId) {
    const [cat] = await db
      .select({ id: berthCategories.id })
      .from(berthCategories)
      .where(and(eq(berthCategories.id, data.categoryId), eq(berthCategories.marinaId, ctx.marinaId)))
      .limit(1);
    if (!cat) return fail("Controlla i campi evidenziati.", { categoryId: "Categoria non trovata." });
  }
  try {
    const updated = await db
      .update(berths)
      .set(data)
      .where(and(eq(berths.id, id), eq(berths.marinaId, ctx.marinaId)))
      .returning({ id: berths.id });
    if (updated.length === 0) return fail("Posto non trovato.");
  } catch (err) {
    return { ...toFormState(err), message: "Esiste già un posto con questo codice.", errors: { code: "Codice già usato" } };
  }
  await audit(ctx, "modifica", "posto barca", id, data.code);
  revalidatePath("/", "layout");
  redirect("/impostazioni/pontili");
}

export async function deleteBerth(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const berthId = String(formData.get("berthId") ?? "");
  try {
    const deleted = await db
      .delete(berths)
      .where(and(eq(berths.id, berthId), eq(berths.marinaId, ctx.marinaId)))
      .returning({ code: berths.code });
    if (deleted.length === 0) return fail("Posto non trovato.");
    await audit(ctx, "eliminazione", "posto barca", berthId, deleted[0].code);
  } catch (err) {
    return { ...toFormState(err), message: "Il posto ha contratti collegati: mettilo fuori servizio invece di eliminarlo." };
  }
  revalidatePath("/", "layout");
  redirect("/impostazioni/pontili");
}

// ───────────────────────── Categorie ─────────────────────────

const categorySchema = z.object({
  id: f.optId(),
  name: f.text("Indica il nome"),
  maxLengthCm: f.meters(),
  maxBeamCm: f.meters(),
  sortOrder: f.int(0, 999, "Numero non valido"),
});

export async function saveCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(categorySchema, formData);
  if (!parsed.ok) return parsed.state;
  const { id, ...data } = parsed.data;
  if (id) {
    const updated = await db
      .update(berthCategories)
      .set(data)
      .where(and(eq(berthCategories.id, id), eq(berthCategories.marinaId, ctx.marinaId)))
      .returning({ id: berthCategories.id });
    if (updated.length === 0) return fail("Categoria non trovata.");
  } else {
    await db.insert(berthCategories).values({ marinaId: ctx.marinaId, ...data });
  }
  revalidatePath("/", "layout");
  return { ok: true, message: id ? "Salvata." : "Categoria aggiunta." };
}

export async function deleteCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const categoryId = String(formData.get("categoryId") ?? "");
  const deleted = await db
    .delete(berthCategories)
    .where(and(eq(berthCategories.id, categoryId), eq(berthCategories.marinaId, ctx.marinaId)))
    .returning({ name: berthCategories.name });
  if (deleted.length === 0) return fail("Categoria non trovata.");
  await audit(ctx, "eliminazione", "categoria", categoryId, deleted[0].name);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────────────────────── Utenti ─────────────────────────

const ROLES = ["admin", "ufficio", "banchina"] as const;

const memberSchema = z.object({
  name: f.text("Inserisci nome e cognome"),
  email: f.email(),
  role: f.choice(ROLES),
  password: password("Password provvisoria di almeno 10 caratteri"),
});

// Aggiunge una persona al porto. Se l'email ha già un account, viene solo collegata al porto
// (nome e password restano i suoi); altrimenti nasce un nuovo account con la password provvisoria.
export async function addMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(memberSchema, formData);
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email)).limit(1);
  if (existing) {
    const [already] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, existing.id), eq(memberships.marinaId, ctx.marinaId)))
      .limit(1);
    if (already) return fail("Controlla i campi evidenziati.", { email: "Questa persona fa già parte del porto." });
    await db.insert(memberships).values({ userId: existing.id, marinaId: ctx.marinaId, role: d.role });
    await audit(ctx, "aggiunta utente", "utente", existing.id, `${d.email} · ${ROLE_LABEL[d.role]}`);
    revalidatePath("/", "layout");
    return { ok: true, message: "L'email aveva già un account: è stata collegata al porto e accede con la password che già usa." };
  }

  try {
    await db.transaction(async (tx) => {
      const userId = await createAccount(tx, { email: d.email, name: d.name, password: d.password });
      await tx.insert(memberships).values({ userId, marinaId: ctx.marinaId, role: d.role });
      await audit(ctx, "aggiunta utente", "utente", userId, `${d.email} · ${ROLE_LABEL[d.role]}`, tx);
    });
  } catch (error) {
    console.error("Creazione dell'account non riuscita", error);
    return fail(ACCOUNT_SERVICE_DOWN);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Utente creato. Comunicagli la password provvisoria: potrà cambiarla dal proprio account." };
}

async function loadMembership(marinaId: string, membershipId: string) {
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.marinaId, marinaId)))
    .limit(1);
  return m ?? null;
}

async function otherAdmins(marinaId: string, membershipId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.marinaId, marinaId), eq(memberships.role, "admin"), ne(memberships.id, membershipId)));
  return count;
}

const roleSchema = z.object({ membershipId: f.id(), role: f.choice(ROLES) });

export async function changeMemberRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(roleSchema, formData);
  if (!parsed.ok) return parsed.state;
  const m = await loadMembership(ctx.marinaId, parsed.data.membershipId);
  if (!m) return fail("Utente non trovato.");
  if (m.role === "admin" && parsed.data.role !== "admin" && (await otherAdmins(ctx.marinaId, m.id)) === 0) {
    return fail("Deve restare almeno una persona con ruolo Direzione.");
  }
  await db.update(memberships).set({ role: parsed.data.role }).where(eq(memberships.id, m.id));
  await audit(ctx, "cambio ruolo", "utente", m.userId, ROLE_LABEL[parsed.data.role]);
  revalidatePath("/", "layout");
  return { ok: true, message: "Ruolo aggiornato." };
}

export async function removeMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const m = await loadMembership(ctx.marinaId, String(formData.get("membershipId") ?? ""));
  if (!m) return fail("Utente non trovato.");
  if (m.userId === ctx.user.id) return fail("Non puoi rimuovere te stesso.");
  if (m.role === "admin" && (await otherAdmins(ctx.marinaId, m.id)) === 0) return fail("Deve restare almeno una persona con ruolo Direzione.");
  await db.delete(memberships).where(eq(memberships.id, m.id));
  await audit(ctx, "rimozione utente", "utente", m.userId);
  revalidatePath("/", "layout");
  return { ok: true };
}

const resetSchema = z.object({ membershipId: f.id(), password: password() });

// La direzione può reimpostare la password solo a chi appartiene esclusivamente a questo porto:
// altrimenti otterrebbe di fatto l'accesso anche agli altri porti di quella persona.
export async function resetMemberPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(resetSchema, formData);
  if (!parsed.ok) return parsed.state;
  const m = await loadMembership(ctx.marinaId, parsed.data.membershipId);
  if (!m) return fail("Utente non trovato.");
  const [{ elsewhere }] = await db
    .select({ elsewhere: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.userId, m.userId), ne(memberships.marinaId, ctx.marinaId)));
  if (elsewhere > 0) return fail("Questa persona lavora anche per altri porti: deve cambiare la password dal proprio account.");

  try {
    await setPassword(m.userId, parsed.data.password);
  } catch (error) {
    console.error("Reimpostazione della password non riuscita", error);
    return fail(ACCOUNT_SERVICE_DOWN);
  }
  // Chiude le sessioni aperte dell'utente (tranne quella di chi sta operando, se è lui stesso).
  await db.execute(sql`delete from sessions where user_id = ${m.userId} and id <> ${ctx.sessionId}`);
  await audit(ctx, "reimpostazione password", "utente", m.userId);
  revalidatePath("/", "layout");
  return { ok: true, message: "Password reimpostata." };
}

// ───────────────────────── Il mio account ─────────────────────────

const ownPasswordSchema = z.object({ current: f.text("Inserisci la password attuale"), password: password() });

export async function changeOwnPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser();
  const parsed = parseForm(ownPasswordSchema, formData);
  if (!parsed.ok) return parsed.state;
  if (!(await checkPassword(ctx.user.id, parsed.data.current))) {
    return fail("Controlla i campi evidenziati.", { current: "Password attuale non corretta." });
  }
  try {
    await setPassword(ctx.user.id, parsed.data.password);
  } catch (error) {
    console.error("Cambio della password non riuscito", error);
    return fail(ACCOUNT_SERVICE_DOWN);
  }
  await db.execute(sql`delete from sessions where user_id = ${ctx.user.id} and id <> ${ctx.sessionId}`);
  return { ok: true, message: "Password aggiornata. Le altre sessioni aperte sono state chiuse." };
}
