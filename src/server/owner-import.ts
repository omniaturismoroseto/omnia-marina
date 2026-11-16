import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { boats, ownerImports, owners } from "@/db/schema";
import { boatIsComplete, checkRow, displayNameOf, groupRows, sameBoat, type ImportBoat, type ImportOwner, type ImportRow } from "@/lib/owner-import";
import type { Actor } from "./contracts";
import { DomainError } from "./errors";

// ───────────────────────── Clienti già presenti ─────────────────────────

const nameKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export interface ExistingOwner {
  id: string;
  displayName: string;
  boatsCount: number;
  activeContract: boolean;
}

export interface MatchQuery {
  key: string;
  fiscalCode: string;
  vatNumber: string;
  name: string;
}

/**
 * Clienti del porto che corrispondono a quelli del file: stesso codice fiscale, stessa partita IVA o,
 * se il file non ne ha, stesso nome. Restituisce, per ogni chiave del file, il cliente trovato.
 */
export async function findExistingOwners(marinaId: string, queries: MatchQuery[], tx: Tx | typeof db = db): Promise<Record<string, ExistingOwner>> {
  if (queries.length === 0) return {};
  const rows = await tx
    .select({
      id: owners.id,
      displayName: owners.displayName,
      fiscalCode: owners.fiscalCode,
      vatNumber: owners.vatNumber,
      boatsCount: sql<number>`(select count(*) from boats b where b.owner_id = "owners"."id")::int`,
      activeContract: sql<boolean>`exists (select 1 from contracts c where c.owner_id = "owners"."id" and c.status = 'attivo')`,
    })
    .from(owners)
    .where(and(eq(owners.marinaId, marinaId), isNull(owners.anonymizedAt)));
  const byFiscal = new Map<string, ExistingOwner>();
  const byVat = new Map<string, ExistingOwner>();
  const byName = new Map<string, ExistingOwner>();
  for (const r of rows) {
    const o = { id: r.id, displayName: r.displayName, boatsCount: r.boatsCount, activeContract: r.activeContract };
    if (r.fiscalCode) byFiscal.set(r.fiscalCode.toUpperCase().replace(/\s/g, ""), o);
    if (r.vatNumber) byVat.set(r.vatNumber.replace(/\D/g, ""), o);
    byName.set(nameKey(r.displayName), o);
  }
  const found: Record<string, ExistingOwner> = {};
  for (const q of queries) {
    const hit =
      (q.fiscalCode && (byFiscal.get(q.fiscalCode.toUpperCase()) ?? byVat.get(q.fiscalCode))) ||
      (q.vatNumber && (byVat.get(q.vatNumber) ?? byFiscal.get(q.vatNumber))) ||
      (!q.fiscalCode && !q.vatNumber ? byName.get(nameKey(q.name)) : undefined);
    if (hit) found[q.key] = hit;
  }
  return found;
}

// ───────────────────────── Importazione ─────────────────────────

export type Decision = "crea" | "completa" | "salta";

export interface OwnerImportInput {
  fileName: string;
  sheetName: string;
  rows: ImportRow[];
  // Per ogni cliente del file (chiave di groupRows): cosa fare se esiste già. Senza scelta: completa l'esistente.
  decisions: Record<string, Decision>;
  // Tutti i clienti importati nella categoria «Ex cliente» (per esempio il foglio dei recessi).
  markFormer: boolean;
}

export interface OwnerImportResult {
  importId: string;
  ownersCreated: number;
  ownersMatched: number; // già presenti, uniti alla scheda esistente
  ownersUpdated: number; // di questi, quelli che hanno ricevuto dati nuovi
  ownersSkipped: number;
  boatsCreated: number;
  boatsSkipped: number; // senza misure o già presenti
}

const nullable = (s: string) => (s.trim() === "" ? null : s.trim());

function ownerValues(o: ImportOwner) {
  return {
    type: o.type,
    firstName: o.type === "persona" ? nullable(o.firstName) : null,
    lastName: o.type === "persona" ? nullable(o.lastName) : null,
    companyName: o.type === "azienda" ? nullable(o.companyName) : null,
    displayName: displayNameOf(o),
    fiscalCode: nullable(o.fiscalCode),
    vatNumber: nullable(o.vatNumber),
    birthDate: nullable(o.birthDate),
    birthPlace: nullable(o.birthPlace),
    address: nullable(o.address),
    zip: nullable(o.zip),
    city: nullable(o.city),
    province: nullable(o.province),
    country: nullable(o.country) ?? "Italia",
    phone: nullable(o.phone),
    email: nullable(o.email),
    pec: nullable(o.pec),
    sdiCode: nullable(o.sdiCode),
    notes: nullable(o.notes),
  };
}

function boatValues(b: ImportBoat & { lengthCm: number; beamCm: number }) {
  return {
    name: b.name.trim(),
    registration: nullable(b.registration),
    type: b.type,
    builder: nullable(b.builder),
    model: nullable(b.model),
    year: b.year,
    lengthCm: b.lengthCm,
    beamCm: b.beamCm,
    draftCm: b.draftCm,
    flag: nullable(b.flag),
    engineType: nullable(b.engineType),
    engineBrand: nullable(b.engineBrand),
    engineCount: b.engineCount,
    enginePowerHp: b.enginePowerHp,
    auxEngineType: nullable(b.auxEngineType),
    auxEngineBrand: nullable(b.auxEngineBrand),
    auxEngineCount: b.auxEngineCount,
    auxEnginePowerHp: b.auxEnginePowerHp,
    declaredValueCents: b.declaredValueCents,
    insuranceCompany: nullable(b.insuranceCompany),
    insurancePolicy: nullable(b.insurancePolicy),
    insuranceExpiry: nullable(b.insuranceExpiry),
  };
}

/**
 * Importa i clienti (e le loro barche) controllati nell'anteprima. Le righe dello stesso cliente diventano un
 * cliente solo con più barche; un cliente già presente si completa nei campi vuoti (mai sovrascritti) oppure si salta.
 */
export async function importOwners(tx: Tx, actor: Actor, input: OwnerImportInput): Promise<OwnerImportResult> {
  const live = input.rows.filter((r) => !r.excluded);
  const blocked = live.filter((r) => checkRow(r).some((i) => i.level === "blocca")).map((r) => r.row);
  if (blocked.length > 0) {
    throw new DomainError(`Righe ancora da sistemare (manca il nome): ${blocked.slice(0, 10).join(", ")}${blocked.length > 10 ? "…" : ""}. Correggile o escludile.`);
  }
  const groups = groupRows(live);
  if (groups.length === 0) throw new DomainError("Nessun cliente da importare.");

  const existing = await findExistingOwners(
    actor.marinaId,
    groups.map((g) => ({ key: g.key, fiscalCode: g.owner.fiscalCode, vatNumber: g.owner.vatNumber, name: displayNameOf(g.owner) })),
    tx,
  );

  const [batch] = await tx
    .insert(ownerImports)
    .values({ marinaId: actor.marinaId, fileName: input.fileName, sheetName: input.sheetName, rowsCount: live.length, ownersCreated: 0, ownersUpdated: 0, boatsCreated: 0, createdBy: actor.userId })
    .returning({ id: ownerImports.id });

  const result: OwnerImportResult = { importId: batch.id, ownersCreated: 0, ownersMatched: 0, ownersUpdated: 0, ownersSkipped: 0, boatsCreated: 0, boatsSkipped: 0 };

  for (const g of groups) {
    const match = existing[g.key];
    const decision: Decision = input.decisions[g.key] ?? (match ? "completa" : "crea");
    if (decision === "salta") {
      result.ownersSkipped++;
      continue;
    }

    let ownerId: string;
    let knownBoats: { name: string; registration: string; lengthCm: number | null }[] = [];
    if (match && decision === "completa") {
      ownerId = match.id;
      result.ownersMatched++;
      const [current] = await tx.select().from(owners).where(and(eq(owners.id, ownerId), eq(owners.marinaId, actor.marinaId))).limit(1);
      // Solo i campi vuoti: quello che c'è già nell'app non si sovrascrive mai.
      const incoming = ownerValues(g.owner);
      const patch: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (["type", "displayName", "firstName", "lastName", "companyName"].includes(k)) continue;
        const now = (current as Record<string, unknown>)[k];
        if ((now === null || now === "") && v) patch[k] = v;
      }
      const becomesFormer = input.markFormer && !current.former && !match.activeContract;
      if (Object.keys(patch).length > 0 || becomesFormer) {
        await tx
          .update(owners)
          .set({ ...patch, ...(becomesFormer ? { former: true } : {}), updatedAt: new Date() })
          .where(eq(owners.id, ownerId));
        result.ownersUpdated++;
      }
      knownBoats = (await tx.select({ name: boats.name, registration: boats.registration, lengthCm: boats.lengthCm }).from(boats).where(eq(boats.ownerId, ownerId))).map(
        (b) => ({ ...b, registration: b.registration ?? "" }),
      );
    } else {
      const [created] = await tx
        .insert(owners)
        .values({ marinaId: actor.marinaId, ...ownerValues(g.owner), former: input.markFormer, importId: batch.id })
        .returning({ id: owners.id });
      ownerId = created.id;
      result.ownersCreated++;
    }

    for (const { boat } of g.boats) {
      if (!boatIsComplete(boat) || knownBoats.some((k) => sameBoat(k, boat))) {
        result.boatsSkipped++;
        continue;
      }
      await tx.insert(boats).values({ marinaId: actor.marinaId, ownerId, ...boatValues(boat), importId: batch.id });
      knownBoats.push({ name: boat.name, registration: boat.registration, lengthCm: boat.lengthCm });
      result.boatsCreated++;
    }
  }

  await tx
    .update(ownerImports)
    .set({ ownersCreated: result.ownersCreated, ownersUpdated: result.ownersUpdated, boatsCreated: result.boatsCreated })
    .where(eq(ownerImports.id, batch.id));
  return result;
}

/**
 * Annulla un'importazione: cancella le barche e i clienti che ha creato, tranne quelli già usati (contratti,
 * addebiti, consensi privacy registrati). I campi completati su clienti già esistenti restano.
 */
export async function undoOwnerImport(tx: Tx, actor: Actor, importId: string) {
  const [batch] = await tx
    .select()
    .from(ownerImports)
    .where(and(eq(ownerImports.id, importId), eq(ownerImports.marinaId, actor.marinaId)))
    .limit(1);
  if (!batch) throw new DomainError("Importazione non trovata.");

  const importedBoats = await tx
    .select({ id: boats.id, used: sql<boolean>`exists (select 1 from contracts c where c.boat_id = "boats"."id")` })
    .from(boats)
    .where(and(eq(boats.importId, importId), eq(boats.marinaId, actor.marinaId)));
  const removableBoats = importedBoats.filter((b) => !b.used).map((b) => b.id);
  if (removableBoats.length > 0) await tx.delete(boats).where(inArray(boats.id, removableBoats));

  const importedOwners = await tx
    .select({
      id: owners.id,
      used: sql<boolean>`(
        exists (select 1 from contracts c where c.owner_id = "owners"."id")
        or exists (select 1 from charges ch where ch.owner_id = "owners"."id")
        or exists (select 1 from boats b where b.owner_id = "owners"."id")
        or exists (select 1 from privacy_consents pc where pc.owner_id = "owners"."id")
      )`,
    })
    .from(owners)
    .where(and(eq(owners.importId, importId), eq(owners.marinaId, actor.marinaId)));
  const removableOwners = importedOwners.filter((o) => !o.used).map((o) => o.id);
  if (removableOwners.length > 0) await tx.delete(owners).where(inArray(owners.id, removableOwners));

  await tx.delete(ownerImports).where(eq(ownerImports.id, importId));
  return {
    fileName: batch.fileName,
    ownersDeleted: removableOwners.length,
    ownersKept: importedOwners.length - removableOwners.length,
    boatsDeleted: removableBoats.length,
    boatsKept: importedBoats.length - removableBoats.length,
  };
}
