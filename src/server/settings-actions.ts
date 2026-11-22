"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { berthCategories, berths, contracts, marinas, memberships, piers, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMarina, requireUser } from "@/lib/context";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { ROLE_LABEL } from "@/lib/labels";
import { renameCodes } from "@/lib/berth-codes";
import { movedOrder, parseIdList } from "@/lib/pier-merge";
import { berthSlots } from "@/lib/plan";
import { pierGroupKey } from "@/lib/pricing";
import { parseCoordinates } from "@/lib/weather";
import { checkPassword, createAccount, setPassword } from "./credentials";
import { DomainError, toFormState } from "./errors";
import { mergePiers, sectionFromBerths, type MergeResult } from "./piers";

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
  waveAlertM: z.preprocess(
    (v) => (typeof v === "string" && /^\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(",", ".")) : Number.NaN),
    z.number({ error: "Scrivi i metri, per esempio 2,5" }).min(0.5, "Almeno 0,5 m").max(10, "Al massimo 10 m"),
  ),
  alertZone: f.optText(),
  windAlertAuto: f.checkbox(),
});

// Area diportisti e allerte: orari, informazioni utili, posizione del porto e allerta vento.
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
  await audit(ctx, "modifica", "porto", ctx.marinaId, "Area diportisti e allerte");
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
  // Risposta alla domanda sul nome già usato: «separati», «esistente» (nuovo pontile: usa quello che c'è) o «unisci:<id>».
  sameName: f.optText(),
});

/** Pontile che ha già il nome scritto nel modulo: il modulo chiede se unirli o tenerli separati. */
export interface SameNamePier {
  id: string;
  code: string;
  name: string;
  berths: number;
}
export type PierFormState = (NonNullable<FormState> & { sameName?: SameNamePier[] }) | undefined;

export async function savePier(_prev: FormState, formData: FormData): Promise<PierFormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(pierSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { id, sameName, ...data } = parsed.data;
  data.code = data.code.toUpperCase();

  // Stesso nome (senza badare a maiuscole e spazi) di un altro pontile: prima si chiede che cosa fare.
  const key = pierGroupKey(data.name);
  const others = await db
    .select({ id: piers.id, code: piers.code, name: piers.name, berths: sql<number>`(select count(*) from "berths" where "berths"."pier_id" = "piers"."id")::int` })
    .from(piers)
    .where(and(eq(piers.marinaId, ctx.marinaId), id ? ne(piers.id, id) : undefined));
  const matches = others.filter((p) => pierGroupKey(p.name) === key);
  // Se il nome non cambia (es. si corregge solo la sigla) la domanda è già stata fatta: niente da chiedere.
  const [current] = id ? await db.select({ name: piers.name }).from(piers).where(and(eq(piers.id, id), eq(piers.marinaId, ctx.marinaId))) : [];
  const nameChanged = !current || pierGroupKey(current.name) !== key;
  if (matches.length > 0 && nameChanged && !sameName) {
    const list = matches.map((p) => `${p.name} (sigla ${p.code})`).join(", ");
    return {
      message: `Il nome è già usato da ${list}. Vuoi unirli in un pontile solo o tenerli separati?`,
      errors: { name: "Nome già usato" },
      sameName: matches,
    };
  }

  const mergeInto = sameName?.startsWith("unisci:") ? matches.find((p) => `unisci:${p.id}` === sameName) : undefined;
  if (sameName && sameName !== "separati" && !mergeInto && !(sameName === "esistente" && !id && matches.length > 0)) {
    return fail("Scelta non valida: riprova.");
  }

  // Nuovo pontile con il nome di uno esistente: non se ne crea un altro, i posti si aggiungono a quello.
  if (!id && (sameName === "esistente" || mergeInto)) {
    const existing = mergeInto ?? matches[0];
    return { ok: true, message: `Nessun nuovo pontile: aggiungi i posti a «${existing.name}» (sigla ${existing.code}).` };
  }

  if (id && mergeInto) {
    let result: MergeResult;
    try {
      result = await db.transaction(async (tx) => {
        const updated = await tx
          .update(piers)
          .set(data)
          .where(and(eq(piers.id, id), eq(piers.marinaId, ctx.marinaId)))
          .returning({ id: piers.id });
        if (updated.length === 0) throw new DomainError("Pontile non trovato.");
        const merged = await mergePiers(tx, ctx.marinaId, mergeInto.id, [id]);
        await audit(ctx, "modifica", "pontile", mergeInto.id, `Unito ${data.code} in ${mergeInto.code} (${merged.moved} posti)`, tx);
        return merged;
      });
    } catch (err) {
      const state = toFormState(err);
      return err instanceof DomainError ? state : { ...state, message: "Esiste già un pontile con questa sigla.", errors: { code: "Sigla già usata" } };
    }
    revalidatePath("/", "layout");
    // La scheda di questo pontile sparisce: il risultato lo mostra la pagina.
    redirect(mergedUrl(result));
  }
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

// Esito dell'unione nell'indirizzo della pagina: lo legge `mergeNotice` in Pontili e posti.
function mergedUrl(r: MergeResult): string {
  const q = new URLSearchParams({ unito: r.target.id, da: r.merged.map((p) => p.code).join(","), posti: String(r.moved) });
  return `/impostazioni/pontili?${q}`;
}

// Unisce in `targetId` tutti i pontili del porto con il suo stesso nome.
export async function mergePierGroup(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const targetId = String(formData.get("targetId") ?? "");
  if (!z.uuid().safeParse(targetId).success) return fail("Pontile non trovato.");
  const all = await db.select({ id: piers.id, name: piers.name }).from(piers).where(eq(piers.marinaId, ctx.marinaId));
  const target = all.find((p) => p.id === targetId);
  if (!target) return fail("Pontile non trovato.");
  const sources = all.filter((p) => p.id !== targetId && pierGroupKey(p.name) === pierGroupKey(target.name)).map((p) => p.id);
  if (sources.length === 0) return fail("Non ci sono altri pontili con questo nome.");
  let result: MergeResult;
  try {
    result = await db.transaction(async (tx) => {
      const merged = await mergePiers(tx, ctx.marinaId, targetId, sources);
      await audit(ctx, "modifica", "pontile", targetId, `Uniti ${merged.merged.map((p) => p.code).join(", ")} in ${merged.target.code} (${merged.moved} posti)`, tx);
      return merged;
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  redirect(mergedUrl(result));
}

// Sposta un pontile di un posto in su o in giù nell'ordine (mappa, elenchi, tariffe).
export async function movePier(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const pierId = String(formData.get("pierId") ?? "");
  const direction = formData.get("direction") === "su" ? "su" : "giu";
  const rows = await db
    .select({ id: piers.id, sortOrder: piers.sortOrder })
    .from(piers)
    .where(eq(piers.marinaId, ctx.marinaId))
    .orderBy(asc(piers.sortOrder), asc(piers.code));
  const order = movedOrder(
    rows.map((p) => p.id),
    pierId,
    direction,
  );
  if (!order) return rows.some((p) => p.id === pierId) ? { ok: true } : fail("Pontile non trovato.");
  // Si riscrive l'ordine 0, 1, 2…: così anche numeri doppi o con buchi tornano in fila.
  const current = new Map(rows.map((p) => [p.id, p.sortOrder]));
  await db.transaction(async (tx) => {
    for (const [i, id] of order.entries()) {
      if (current.get(id) !== i) await tx.update(piers).set({ sortOrder: i }).where(and(eq(piers.id, id), eq(piers.marinaId, ctx.marinaId)));
    }
  });
  revalidatePath("/", "layout");
  return { ok: true };
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

const keep = <T extends string>(values: readonly [T, ...T[]]) => z.preprocess((v) => (v === "" || v === undefined ? null : v), z.enum(values).nullable());

const berthsBulkSchema = z.object({
  pierId: f.id(),
  categoryId: f.optId(),
  categorySizes: f.checkbox(),
  lengthCm: f.optMeters(),
  beamCm: f.optMeters(),
  draftCm: f.optMeters(),
  status: keep(["attivo", "manutenzione", "fuori_servizio"]),
  hasWater: keep(["si", "no"]),
  hasPower: keep(["si", "no"]),
});

// Posti scelti nella scheda di un pontile: solo quelli del porto e di quel pontile.
async function pickedBerths(marinaId: string, pierId: string, formData: FormData) {
  const ids = parseIdList(formData.get("berthIds"));
  if (ids.length === 0) return [];
  return db
    .select({ id: berths.id, code: berths.code })
    .from(berths)
    .where(and(eq(berths.marinaId, marinaId), eq(berths.pierId, pierId), inArray(berths.id, ids)));
}

// Cambia insieme i posti scelti: i campi lasciati su «non cambiare» (o vuoti) restano come sono.
export async function updateBerths(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(berthsBulkSchema, formData);
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  const list = await pickedBerths(ctx.marinaId, d.pierId, formData);
  if (list.length === 0) return fail("Scegli almeno un posto.");

  const set: Partial<typeof berths.$inferInsert> = {};
  if (d.categoryId) {
    const [category] = await db
      .select()
      .from(berthCategories)
      .where(and(eq(berthCategories.id, d.categoryId), eq(berthCategories.marinaId, ctx.marinaId)))
      .limit(1);
    if (!category) return fail("Controlla i campi evidenziati.", { categoryId: "Categoria non trovata." });
    set.categoryId = category.id;
    if (d.categorySizes) {
      set.lengthCm = category.maxLengthCm;
      set.beamCm = category.maxBeamCm;
    }
  } else if (d.categorySizes) {
    return fail("Controlla i campi evidenziati.", { categoryId: "Scegli la categoria da cui prendere le misure." });
  }
  if (d.lengthCm !== null) set.lengthCm = d.lengthCm;
  if (d.beamCm !== null) set.beamCm = d.beamCm;
  if (d.draftCm !== null) set.draftCm = d.draftCm;
  if (d.status) set.status = d.status;
  if (d.hasWater) set.hasWater = d.hasWater === "si";
  if (d.hasPower) set.hasPower = d.hasPower === "si";
  if (Object.keys(set).length === 0) return fail("Scegli che cosa cambiare.");

  await db
    .update(berths)
    .set(set)
    .where(
      and(
        eq(berths.marinaId, ctx.marinaId),
        inArray(
          berths.id,
          list.map((b) => b.id),
        ),
      ),
    );
  await audit(ctx, "modifica", "posti barca", d.pierId, `${list.length} posti (${list.map((b) => b.code).join(", ")})`);
  revalidatePath("/", "layout");
  return { ok: true, message: `${list.length} ${list.length === 1 ? "posto aggiornato" : "posti aggiornati"}.` };
}

const renameSchema = z.object({
  pierId: f.id(),
  prefix: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(1, "Indica la sigla").max(6, "Al massimo 6 caratteri")),
  numbering: f.choice(["mantieni", "rinumera"]),
  from: f.int(0, 999, "Numero non valido"),
});

// Cambia sigla (e, se serve, numeri) ai posti scelti: CN01…CS35 → G01…G65. I contratti restano collegati ai posti.
export async function renameBerths(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(renameSchema, formData);
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  const list = await pickedBerths(ctx.marinaId, d.pierId, formData);
  if (list.length === 0) return fail("Scegli almeno un posto.");
  const result = renameCodes(list, d.prefix, d.numbering === "rinumera" ? { mode: "rinumera", from: d.from } : { mode: "mantieni" });
  if (!result.ok) return fail(result.message);
  const changes = result.codes.filter((c) => list.find((b) => b.id === c.id)!.code !== c.code);
  if (changes.length === 0) return { ok: true, message: "I codici sono già questi." };

  // Un codice nuovo non può essere di un posto rimasto fuori dalla scelta (anche su un altro pontile).
  const picked = list.map((b) => b.id);
  const [clash] = await db
    .select({ code: berths.code })
    .from(berths)
    .where(
      and(
        eq(berths.marinaId, ctx.marinaId),
        inArray(
          berths.code,
          changes.map((c) => c.code),
        ),
        notInArray(berths.id, picked),
      ),
    )
    .limit(1);
  if (clash) return fail(`Il codice ${clash.code} è già di un altro posto: scegli un'altra sigla o un altro numero di partenza.`);

  await db.transaction(async (tx) => {
    // Prima codici provvisori, poi quelli nuovi: così due posti scelti possono anche scambiarsi il codice.
    for (const c of changes) {
      await tx.update(berths).set({ code: `~${c.id}` }).where(and(eq(berths.id, c.id), eq(berths.marinaId, ctx.marinaId)));
    }
    for (const c of changes) {
      await tx.update(berths).set({ code: c.code }).where(and(eq(berths.id, c.id), eq(berths.marinaId, ctx.marinaId)));
    }
    const first = changes[0];
    const last = changes[changes.length - 1];
    await audit(ctx, "modifica", "posti barca", d.pierId, `Codici di ${changes.length} posti (${list.find((b) => b.id === first.id)!.code} → ${first.code} … ${last.code})`, tx);
  });
  revalidatePath("/", "layout");
  const codes = result.codes.map((c) => c.code);
  return { ok: true, message: `${changes.length} ${changes.length === 1 ? "codice cambiato" : "codici cambiati"}: ora da ${codes[0]} a ${codes[codes.length - 1]}.` };
}

const sectionSchema = z.object({
  pierId: f.id(),
  label: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(1, "Dai un nome al tratto").max(20, "Al massimo 20 caratteri")),
});

// I posti scelti diventano un tratto della pianta, che nell'editor si sposta e si traccia da solo.
export async function makeBerthSection(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const parsed = parseForm(sectionSchema, formData);
  if (!parsed.ok) return parsed.state;
  const ids = parseIdList(formData.get("berthIds"));
  try {
    const count = await db.transaction(async (tx) => {
      const n = await sectionFromBerths(tx, ctx.marinaId, parsed.data.pierId, ids, parsed.data.label);
      await audit(ctx, "modifica", "pontile", parsed.data.pierId, `Tratto «${parsed.data.label}» della pianta (${n} posti)`, tx);
      return n;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Tratto «${parsed.data.label}» creato con ${count} ${count === 1 ? "posto" : "posti"}: in Pianta dal vero ora si sposta da solo.` };
  } catch (err) {
    return toFormState(err);
  }
}

// Elimina i posti scelti; quelli con contratti (anche vecchi) restano: vanno messi fuori servizio.
export async function deleteBerths(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(ADMIN);
  const pierId = String(formData.get("pierId") ?? "");
  if (!z.uuid().safeParse(pierId).success) return fail("Pontile non trovato.");
  const list = await pickedBerths(ctx.marinaId, pierId, formData);
  if (list.length === 0) return fail("Scegli almeno un posto.");
  const ids = list.map((b) => b.id);
  const linked = await db
    .selectDistinct({ berthId: contracts.berthId })
    .from(contracts)
    .where(and(eq(contracts.marinaId, ctx.marinaId), inArray(contracts.berthId, ids)));
  const blocked = new Set(linked.map((r) => r.berthId));
  const free = list.filter((b) => !blocked.has(b.id));
  if (free.length > 0) {
    await db.delete(berths).where(
      and(
        eq(berths.marinaId, ctx.marinaId),
        inArray(
          berths.id,
          free.map((b) => b.id),
        ),
      ),
    );
    await audit(ctx, "eliminazione", "posti barca", pierId, `${free.length} posti (${free.map((b) => b.code).join(", ")})`);
  }
  revalidatePath("/", "layout");
  const kept = list.filter((b) => blocked.has(b.id)).map((b) => b.code);
  const text = `${free.length} ${free.length === 1 ? "posto eliminato" : "posti eliminati"}.`;
  if (kept.length === 0) return { ok: true, message: text };
  return {
    ok: free.length > 0,
    message: `${free.length > 0 ? `${text} ` : ""}${kept.join(", ")} ${kept.length === 1 ? "ha contratti collegati" : "hanno contratti collegati"}: mettili fuori servizio invece di eliminarli.`,
  };
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
