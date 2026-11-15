// Test delle regole del porto contro un database PostgreSQL reale (omnia_marina_test).
// Se il database di test non è raggiungibile i test vengono saltati.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { db } from "@/db";
import { berthCategories, berths, boats, charges, contractItems, contracts, ledgerEntries, ledgerImports, marinas, movements, owners, piers, priceListExtras, priceLists, rates, tariffZones, users } from "@/db/schema";
import { addDays, todayRome } from "@/lib/dates";
import { deletePayment, importLedger, registerPayment, undoLedgerImport } from "@/server/accounting";
import { activateContract, addContractItem, cancelContract, createContract, recordMovement, removeContractItem, type ContractInput } from "@/server/contracts";
import { DomainError, toFormState } from "@/server/errors";
import { CONTRACT_APPROVAL_TEMPLATE, CONTRACT_TERMS_TEMPLATE } from "@/lib/contract-texts";
import { createMarinaWithDefaults } from "@/server/marina-setup";
import { loadOfficialPriceList, OFFICIAL_CATEGORIES, OFFICIAL_EXTRAS } from "@/server/official-price-list";
import { zoneRate } from "@/lib/pricing";

async function databaseAvailable(): Promise<boolean> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const available = await databaseAvailable();
const today = todayRome();

interface World {
  marinaId: string;
  userId: string;
  ownerId: string;
  boatId: string;
  otherBoatId: string;
  berthId: string;
  smallBerthId: string;
}

// Crea un porto con un cliente, due barche e due posti (uno grande, uno troppo piccolo).
async function createWorld(name: string): Promise<World> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: `${name.toLowerCase()}-${Date.now()}@test.example`, name: `Utente ${name}`, passwordHash: "x" })
      .returning({ id: users.id });
    const marinaId = await createMarinaWithDefaults(tx, { name, userId: user.id, year: 2026 });
    const categories = await tx.select().from(berthCategories).where(eq(berthCategories.marinaId, marinaId)).orderBy(berthCategories.sortOrder);
    const [pier] = await tx.insert(piers).values({ marinaId, code: "A", name: "Pontile A" }).returning({ id: piers.id });
    const [berth] = await tx
      .insert(berths)
      .values({ marinaId, pierId: pier.id, categoryId: categories[2].id, code: "A01", lengthCm: 1000, beamCm: 350 })
      .returning({ id: berths.id });
    const [small] = await tx
      .insert(berths)
      .values({ marinaId, pierId: pier.id, categoryId: categories[0].id, code: "A02", lengthCm: 600, beamCm: 250 })
      .returning({ id: berths.id });
    const [owner] = await tx.insert(owners).values({ marinaId, type: "persona", firstName: "Ada", lastName: "Prova", displayName: "Prova Ada" }).returning({ id: owners.id });
    const [boat] = await tx.insert(boats).values({ marinaId, ownerId: owner.id, name: "Alfa", lengthCm: 900, beamCm: 300 }).returning({ id: boats.id });
    const [other] = await tx.insert(boats).values({ marinaId, ownerId: owner.id, name: "Beta", lengthCm: 850, beamCm: 290 }).returning({ id: boats.id });
    return { marinaId, userId: user.id, ownerId: owner.id, boatId: boat.id, otherBoatId: other.id, berthId: berth.id, smallBerthId: small.id };
  });
}

function input(w: World, overrides: Partial<ContractInput> = {}): ContractInput {
  return {
    ownerId: w.ownerId,
    boatId: w.boatId,
    berthId: w.berthId,
    type: "transito",
    status: "attivo",
    startDate: today,
    endDate: addDays(today, 3),
    amountCents: 30000,
    vatRate: 22,
    signedOn: null,
    notes: null,
    instalments: { count: 1, firstDueDate: today, everyMonths: 1 },
    ...overrides,
  };
}

const actor = (w: World) => ({ marinaId: w.marinaId, userId: w.userId });
const create = (w: World, overrides: Partial<ContractInput> = {}) => db.transaction((tx) => createContract(tx, actor(w), input(w, overrides)));

describe.skipIf(!available)("regole del porto (database)", () => {
  let a: World;
  let b: World;

  beforeAll(async () => {
    // Database di test ricreato da zero a ogni esecuzione.
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`create schema public`);
    await migrate(db, { migrationsFolder: "./drizzle" });
    a = await createWorld("Alfa");
    b = await createWorld("Bravo");
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("un posto non può avere due contratti attivi nello stesso periodo", async () => {
    await create(a);
    await expect(create(a, { boatId: a.otherBoatId, startDate: addDays(today, 2), endDate: addDays(today, 5) })).rejects.toThrow(/già assegnato/);
  });

  it("nel giorno di partenza di un transito il posto è già libero per un nuovo arrivo", async () => {
    const next = await create(a, { boatId: a.otherBoatId, startDate: addDays(today, 3), endDate: addDays(today, 4) });
    expect(next.number).toMatch(/^\d{4}\/0002$/);
  });

  it("anche aggirando i controlli dell'applicazione, il database rifiuta la sovrapposizione", async () => {
    const overlapping = db.insert(contracts).values({
      marinaId: a.marinaId,
      year: 2026,
      seq: 900,
      number: "2026/0900",
      ownerId: a.ownerId,
      boatId: a.otherBoatId,
      berthId: a.berthId,
      type: "transito",
      status: "attivo",
      startDate: addDays(today, 1),
      endDate: addDays(today, 2),
      occupiedUntil: addDays(today, 2),
    });
    const error = await overlapping.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeNull();
    expect(toFormState(error).message).toMatch(/già assegnato/);
  });

  it("una barca più grande del posto viene rifiutata", async () => {
    await expect(create(a, { berthId: a.smallBerthId, startDate: addDays(today, 20), endDate: addDays(today, 22) })).rejects.toThrow(/più grande del posto/);
  });

  it("non si possono usare posti, barche o clienti di un altro porto", async () => {
    await expect(create(a, { berthId: b.berthId, startDate: addDays(today, 30), endDate: addDays(today, 31) })).rejects.toThrow(DomainError);
    await expect(create(a, { ownerId: b.ownerId, boatId: b.boatId, berthId: a.berthId, startDate: addDays(today, 30), endDate: addDays(today, 31) })).rejects.toThrow(DomainError);
    // Un operatore del porto Bravo non può muovere una barca del porto Alfa.
    const [mine] = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.marinaId, a.marinaId)).limit(1);
    await expect(db.transaction((tx) => recordMovement(tx, actor(b), mine.id, "arrivo"))).rejects.toThrow(/non trovato/);
  });

  it("la numerazione dei contratti è separata per porto", async () => {
    const first = await create(b);
    expect(first.number).toMatch(/\/0001$/);
  });

  it("le rate sommano all'importo e la bozza non genera addebiti né impegna il posto", async () => {
    const draft = await create(a, {
      type: "annuale",
      status: "bozza",
      startDate: "2030-01-01",
      endDate: "2030-12-31",
      amountCents: 100000,
      instalments: { count: 3, firstDueDate: "2030-01-31", everyMonths: 4 },
    });
    expect(await db.select().from(charges).where(eq(charges.contractId, draft.id))).toHaveLength(0);

    // La bozza non blocca: un altro contratto attivo può prendere lo stesso posto nello stesso periodo…
    const taker = await create(a, { boatId: a.otherBoatId, type: "mensile", startDate: "2030-03-01", endDate: "2030-03-31" });
    // …e a quel punto la bozza non si può più attivare.
    const plan = { count: 3, firstDueDate: "2030-01-31", everyMonths: 4 };
    await expect(db.transaction((tx) => activateContract(tx, actor(a), draft.id, plan))).rejects.toThrow(/già assegnato/);

    await db.transaction((tx) => cancelContract(tx, actor(a), taker.id));
    await db.transaction((tx) => activateContract(tx, actor(a), draft.id, plan));
    const rows = await db.select().from(charges).where(eq(charges.contractId, draft.id)).orderBy(charges.dueDate);
    expect(rows.map((r) => r.grossCents)).toEqual([33333, 33333, 33334]);
    expect(rows.map((r) => r.dueDate)).toEqual(["2030-01-31", "2030-05-31", "2030-09-30"]);
    expect(rows.every((r) => r.netCents + r.vatCents === r.grossCents)).toBe(true);
  });

  it("il listino ufficiale 2026 si carica con la zona della darsena C e ricaricandolo non duplica nulla", async () => {
    const first = await db.transaction((tx) => loadOfficialPriceList(tx, b.marinaId));
    expect(first.createdCategories).toBe(OFFICIAL_CATEGORIES.length);
    const again = await db.transaction((tx) => loadOfficialPriceList(tx, b.marinaId));
    expect(again).toEqual({ ...first, createdCategories: 0 });

    // Il porto aveva già il "Listino 2026": viene riempito, non duplicato.
    expect(await db.select().from(priceLists).where(and(eq(priceLists.marinaId, b.marinaId), eq(priceLists.name, "Listino 2026")))).toHaveLength(1);
    expect(await db.select().from(tariffZones).where(eq(tariffZones.marinaId, b.marinaId))).toHaveLength(1);
    const extras = await db.select().from(priceListExtras).where(eq(priceListExtras.priceListId, first.listId));
    expect(extras).toHaveLength(OFFICIAL_EXTRAS.length);
    expect(extras.find((e) => e.name === "Posto auto coperto")?.itemKind).toBe("auto_coperto");

    const rows = await db
      .select({ name: berthCategories.name, rate: rates })
      .from(rates)
      .innerJoin(berthCategories, eq(berthCategories.id, rates.categoryId))
      .where(eq(rates.priceListId, first.listId));
    const priceOf = (name: string, zoneId: string | null) =>
      zoneRate(
        rows.filter((r) => r.name === name).map((r) => r.rate),
        zoneId,
      );
    expect(priceOf("B · fino a 6 m", null)).toMatchObject({ annual: 131000, waste: 4000, seasonal: 90000, monthlyLow: 25000, monthlyHigh: 25000 });
    expect(priceOf("B · fino a 6 m", first.zoneId)).toMatchObject({ annual: 146000, waste: 4000, seasonal: 90000, monthlyLow: 25000 });
    expect(priceOf("H · fino a 12 m", null)).toBeNull(); // solo nella darsena C
    expect(priceOf("I · oltre 12 m", first.zoneId)).toMatchObject({ annual: 350000, waste: 9000, seasonal: 0 });
    // I totali del foglio (annuale + rifiuti) tornano per ogni riga.
    const total = (name: string, zoneId: string | null) => {
      const r = priceOf(name, zoneId)!;
      return (r.annual + r.waste) / 100;
    };
    expect(OFFICIAL_CATEGORIES.filter((c) => c.base).map((c) => total(c.name, null))).toEqual([1350, 1660, 1820, 2070, 2190, 2390]);
    expect(OFFICIAL_CATEGORIES.map((c) => total(c.name, first.zoneId))).toEqual([1500, 1760, 2020, 2270, 2540, 2890, 3290, 3590]);
  });

  it("arrivo, uscita, rientro e partenza anticipata liberano il posto", async () => {
    const [c] = await db
      .select()
      .from(contracts)
      .where(and(eq(contracts.marinaId, a.marinaId), eq(contracts.number, `${today.slice(0, 4)}/0001`)))
      .limit(1);
    const move = (kind: "arrivo" | "uscita" | "rientro" | "partenza") => db.transaction((tx) => recordMovement(tx, actor(a), c.id, kind));

    await expect(move("rientro")).rejects.toThrow(/non coerente/);
    await move("arrivo");
    await move("uscita");
    await move("rientro");
    await move("partenza");

    const [after] = await db.select().from(contracts).where(eq(contracts.id, c.id));
    expect(after.status).toBe("concluso");
    expect(after.presence).toBe("partito");
    // Partita oggi invece che tra tre giorni: il periodo si accorcia e il posto torna disponibile da domani.
    expect(after.occupiedUntil).toBe(addDays(today, 1));
    expect(await db.select().from(movements).where(eq(movements.contractId, c.id))).toHaveLength(4);
    await expect(create(a, { boatId: a.otherBoatId, startDate: addDays(today, 1), endDate: addDays(today, 2) })).resolves.toBeTruthy();
  });

  it("un incasso crea la riga di prima nota, non può superare il residuo e si può stornare", async () => {
    const [c] = await db
      .select()
      .from(contracts)
      .where(and(eq(contracts.marinaId, a.marinaId), eq(contracts.number, `${today.slice(0, 4)}/0001`)))
      .limit(1);
    const [charge] = await db.select().from(charges).where(eq(charges.contractId, c.id));
    const pay = (amountCents: number, method: "contanti" | "bonifico") =>
      db.transaction((tx) => registerPayment(tx, actor(a), { chargeId: charge.id, paidOn: today, amountCents, method, reference: null }));

    await expect(pay(charge.grossCents + 1, "bonifico")).rejects.toThrow(/supera il residuo/);
    const first = await pay(10000, "contanti");
    await pay(charge.grossCents - 10000, "bonifico");
    await expect(pay(1, "bonifico")).rejects.toThrow(/supera il residuo/);

    const ledger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.marinaId, a.marinaId));
    expect(ledger.map((l) => l.account).sort()).toEqual(["banca", "cassa"]);
    expect(ledger.reduce((s, l) => s + l.amountCents, 0)).toBe(charge.grossCents);

    // Un altro porto non può toccare l'incasso.
    await expect(db.transaction((tx) => deletePayment(tx, actor(b), first))).rejects.toThrow(/non trovato/);
    await db.transaction((tx) => deletePayment(tx, actor(a), first));
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.marinaId, a.marinaId))).toHaveLength(1);
  });

  it("annullare un contratto annulla solo gli addebiti non incassati", async () => {
    const c = await create(a, { boatId: a.otherBoatId, startDate: addDays(today, 40), endDate: addDays(today, 42), instalments: { count: 2, firstDueDate: addDays(today, 40), everyMonths: 1 } });
    const [paid] = await db.select().from(charges).where(eq(charges.contractId, c.id)).orderBy(charges.dueDate);
    await db.transaction((tx) => registerPayment(tx, actor(a), { chargeId: paid.id, paidOn: today, amountCents: 5000, method: "pos", reference: null }));
    await db.transaction((tx) => cancelContract(tx, actor(a), c.id));
    const rows = await db.select().from(charges).where(eq(charges.contractId, c.id)).orderBy(charges.dueDate);
    expect(rows.map((r) => r.cancelledAt !== null)).toEqual([false, true]);
  });

  it("una prima nota importata si salva una volta sola e si annulla tutta insieme", async () => {
    const entry = (entryDate: string, amountCents: number) => ({
      entryDate,
      direction: "entrata" as const,
      account: "cassa" as const,
      amountCents,
      category: "Ormeggi",
      description: "Ormeggio, saldo 2026",
      counterparty: "FRANCHI",
      documentRef: null,
    });
    const file = { fileName: "PRIMANOTA2026.xlsx", fileHash: "a".repeat(64), sheetName: "primanota", rowsCount: 2 };
    const before = (await db.select().from(ledgerEntries).where(eq(ledgerEntries.marinaId, a.marinaId))).length;
    const id = await db.transaction((tx) => importLedger(tx, actor(a), { ...file, entries: [entry("2026-03-01", 1000), entry("2026-01-16", 2000)] }));

    const [imp] = await db.select().from(ledgerImports).where(eq(ledgerImports.id, id));
    expect(imp).toMatchObject({ entriesCount: 2, firstDate: "2026-01-16", lastDate: "2026-03-01" });
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.importId, id))).toHaveLength(2);

    // Lo stesso file non entra due volte; un altro porto può importarlo per sé ma non annullare quello altrui.
    await expect(db.transaction((tx) => importLedger(tx, actor(a), { ...file, entries: [entry("2026-01-16", 2000)] }))).rejects.toThrow(/già stato importato/);
    await expect(db.transaction((tx) => undoLedgerImport(tx, actor(b), id))).rejects.toThrow(/non trovata/);
    await expect(db.transaction((tx) => importLedger(tx, actor(a), { ...file, fileHash: "b".repeat(64), entries: [] }))).rejects.toThrow(/Non ci sono movimenti/);

    await db.transaction((tx) => undoLedgerImport(tx, actor(a), id));
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.marinaId, a.marinaId))).toHaveLength(before);
  });

  it("un nuovo porto nasce con le condizioni del contratto dall'articolo 4 e l'approvazione specifica", async () => {
    const [m] = await db.select().from(marinas).where(eq(marinas.id, a.marinaId));
    expect(m.contractTerms).toBe(CONTRACT_TERMS_TEMPLATE);
    expect(m.contractTerms?.startsWith("4)")).toBe(true);
    expect(m.contractApprovalText).toBe(CONTRACT_APPROVAL_TEMPLATE);
  });

  it("le voci aggiuntive nascono con il contratto e diventano addebiti solo all'attivazione", async () => {
    const draft = await create(a, {
      type: "annuale",
      status: "bozza",
      startDate: "2031-01-01",
      endDate: "2031-12-31",
      amountCents: 116000,
      instalments: { count: 1, firstDueDate: "2031-01-01", everyMonths: 1 },
      items: [
        { kind: "auto_coperto", reference: "12", startDate: "2031-01-01", endDate: "2031-12-31", amountCents: 30000 },
        { kind: "gestione", reference: null, startDate: null, endDate: null, amountCents: 15000 },
        { kind: "rifiuti", reference: null, startDate: null, endDate: null, amountCents: 4000 },
      ],
    });
    expect(await db.select().from(contractItems).where(eq(contractItems.contractId, draft.id))).toHaveLength(3);
    expect(await db.select().from(charges).where(eq(charges.contractId, draft.id))).toHaveLength(0);

    await db.transaction((tx) => activateContract(tx, actor(a), draft.id, { count: 1, firstDueDate: "2031-01-01", everyMonths: 1 }));
    const rows = await db.select().from(charges).where(eq(charges.contractId, draft.id));
    expect(rows.map((r) => r.grossCents).sort((x, y) => x - y)).toEqual([4000, 15000, 30000, 116000]);
    expect(rows.every((r) => r.dueDate === "2031-01-01" && r.netCents + r.vatCents === r.grossCents)).toBe(true);
    expect(rows.find((r) => r.grossCents === 30000)?.description).toMatch(/Posto auto coperto n\. 12/);
    const items = await db.select().from(contractItems).where(eq(contractItems.contractId, draft.id));
    expect(items.every((it) => it.chargeId !== null)).toBe(true);
  });

  it("le spese fisse compaiono una volta sola e gli spazi vogliono un periodo coerente", async () => {
    const fee = { kind: "gestione" as const, reference: null, startDate: null, endDate: null, amountCents: 100 };
    await expect(create(a, { status: "bozza", items: [fee, fee] })).rejects.toThrow(/già presente/);
    await expect(
      create(a, { status: "bozza", items: [{ kind: "carrello", reference: null, startDate: "2031-05-01", endDate: "2031-04-01", amountCents: 100 }] }),
    ).rejects.toThrow(/precede/);
    await expect(create(a, { status: "bozza", items: [{ kind: "secca", reference: null, startDate: null, endDate: null, amountCents: 100 }] })).rejects.toThrow(
      /periodo/,
    );
  });

  it("una voce aggiunta a un contratto attivo si addebita subito e si toglie solo se non incassata", async () => {
    const c = await create(a, { boatId: a.otherBoatId, startDate: addDays(today, 60), endDate: addDays(today, 62) });
    await db.transaction((tx) =>
      addContractItem(tx, actor(a), c.id, { kind: "carrello", reference: null, startDate: addDays(today, 60), endDate: addDays(today, 62), amountCents: 2500 }),
    );
    await db.transaction((tx) => addContractItem(tx, actor(a), c.id, { kind: "rifiuti", reference: null, startDate: null, endDate: null, amountCents: 4000 }));
    const items = await db.select().from(contractItems).where(eq(contractItems.contractId, c.id));
    const carrello = items.find((it) => it.kind === "carrello")!;
    const quota = items.find((it) => it.kind === "rifiuti")!;
    const [carrelloCharge] = await db.select().from(charges).where(eq(charges.id, carrello.chargeId!));
    expect(carrelloCharge).toMatchObject({ grossCents: 2500, dueDate: today, kind: "servizi" });

    // Un altro porto non vede la voce.
    await expect(db.transaction((tx) => removeContractItem(tx, actor(b), carrello.id))).rejects.toThrow(/non trovata/);

    await db.transaction((tx) => registerPayment(tx, actor(a), { chargeId: quota.chargeId!, paidOn: today, amountCents: 4000, method: "contanti", reference: null }));
    await expect(db.transaction((tx) => removeContractItem(tx, actor(a), quota.id))).rejects.toThrow(/già stata incassata/);

    await db.transaction((tx) => removeContractItem(tx, actor(a), carrello.id));
    const [cancelled] = await db.select().from(charges).where(eq(charges.id, carrello.chargeId!));
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(await db.select().from(contractItems).where(eq(contractItems.contractId, c.id))).toHaveLength(1);
  });

  it("tariffe: una sola riga per listino, categoria e zona, anche per la tariffa base", async () => {
    const [list] = await db.select().from(priceLists).where(eq(priceLists.marinaId, a.marinaId)).limit(1);
    const [cat] = await db.select().from(berthCategories).where(eq(berthCategories.marinaId, a.marinaId)).limit(1);
    const [zone] = await db.insert(tariffZones).values({ marinaId: a.marinaId, name: "Darsena C" }).returning({ id: tariffZones.id });
    // Come saveRates: inserisce o aggiorna la riga di quella zona.
    const save = (zoneId: string | null, annual: number) =>
      db
        .insert(rates)
        .values({ marinaId: a.marinaId, priceListId: list.id, categoryId: cat.id, zoneId, annual })
        .onConflictDoUpdate({ target: [rates.priceListId, rates.categoryId, rates.zoneId], set: { annual } });

    await save(null, 131000);
    await save(null, 132000);
    await save(zone.id, 171000);
    await save(zone.id, 172000);
    const rows = await db.select().from(rates).where(and(eq(rates.priceListId, list.id), eq(rates.categoryId, cat.id)));
    expect(rows.map((r) => [r.zoneId, r.annual]).sort()).toEqual([
      [null, 132000],
      [zone.id, 172000],
    ].sort());
    // Senza aggiornamento, una seconda riga base è rifiutata.
    await expect(db.insert(rates).values({ marinaId: a.marinaId, priceListId: list.id, categoryId: cat.id, annual: 1 })).rejects.toThrow();

    // Eliminando la zona, i suoi prezzi spariscono e i pontili tornano alla tariffa base.
    const [pier] = await db.select().from(piers).where(eq(piers.marinaId, a.marinaId)).limit(1);
    await db.update(piers).set({ tariffZoneId: zone.id }).where(eq(piers.id, pier.id));
    await db.delete(tariffZones).where(eq(tariffZones.id, zone.id));
    expect((await db.select().from(rates).where(eq(rates.categoryId, cat.id))).map((r) => r.zoneId)).toEqual([null]);
    expect((await db.select().from(piers).where(eq(piers.id, pier.id)))[0].tariffZoneId).toBeNull();
  });
});
