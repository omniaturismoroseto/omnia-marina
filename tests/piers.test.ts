import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { db } from "@/db";
import { berthCategories, berths, boats, contracts, owners, pierSections, piers, priceLists, rates, users } from "@/db/schema";
import { appendPositions, movedOrder, parseIdList } from "@/lib/pier-merge";
import { planUnits, unitPositions } from "@/lib/plan-units";
import { createMarinaWithDefaults } from "@/server/marina-setup";
import { mergePiers, sectionFromBerths } from "@/server/piers";

describe("unione dei pontili: regole pure", () => {
  it("strutture della pianta: un'unità per tratto, posizioni dalla radice del tratto", () => {
    const line = (x: number) => ({ a: { x, y: 0 }, b: { x, y: 100 }, widthM: 2 });
    const berthsList = [
      { id: "g1", pierId: "G", sectionId: "cn", side: "sx" as const, position: 0 },
      { id: "g2", pierId: "G", sectionId: "cs", side: "sx" as const, position: 1 },
      { id: "g3", pierId: "G", sectionId: "cs", side: "sx" as const, position: 2 },
      { id: "g4", pierId: "G", sectionId: null, side: "dx" as const, position: 5 },
      { id: "b1", pierId: "B", sectionId: null, side: "sx" as const, position: 0 },
    ];
    const units = planUnits(
      [
        { id: "G", name: "Pontile G", trace: null, sections: [{ id: "cn", label: "CN", trace: line(0) }, { id: "cs", label: "CS", trace: line(50) }] },
        { id: "B", name: "Pontile B", trace: line(90), sections: [] },
      ],
      berthsList,
    );
    expect(units.map((u) => [u.id, u.name, u.berths.map((b) => b.id)])).toEqual([
      ["cn", "Pontile G · tratto CN", ["g1"]],
      ["cs", "Pontile G · tratto CS", ["g2", "g3"]],
      ["G", "Pontile G", ["g4"]],
      ["B", "Pontile B", ["b1"]],
    ]);
    expect(units[1].trace).toEqual(line(50));
    expect(Object.fromEntries(unitPositions(units[1].berths))).toEqual({ g2: 0, g3: 1 });
  });

  it("i posti che arrivano proseguono dopo quelli del pontile, lato per lato", () => {
    const existing = [
      { side: "sx" as const, position: 0 },
      { side: "sx" as const, position: 1 },
      { side: "dx" as const, position: 0 },
    ];
    const moved = appendPositions(existing, [
      { id: "b", side: "sx", position: 5 },
      { id: "a", side: "sx", position: 3 },
      { id: "c", side: "dx", position: 0 },
    ]);
    expect(Object.fromEntries(moved)).toEqual({ a: 2, b: 3, c: 1 });
  });

  it("ordine: su e giù, niente oltre i bordi", () => {
    expect(movedOrder(["a", "b", "c"], "b", "su")).toEqual(["b", "a", "c"]);
    expect(movedOrder(["a", "b", "c"], "b", "giu")).toEqual(["a", "c", "b"]);
    expect(movedOrder(["a", "b", "c"], "a", "su")).toBeNull();
    expect(movedOrder(["a", "b", "c"], "c", "giu")).toBeNull();
    expect(movedOrder(["a"], "x", "su")).toBeNull();
  });

  it("elenco di posti scelti: solo uuid, senza doppioni", () => {
    const id = "0b9f6c3e-1d2a-4b5c-8d7e-9f0a1b2c3d4e";
    expect(parseIdList(`${id}, ${id.toUpperCase()},x,'; drop`)).toEqual([id]);
    expect(parseIdList(undefined)).toEqual([]);
  });
});

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

const hasDb = await databaseAvailable();
const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("unione dei pontili (database)", () => {
  let marinaId: string;
  let otherMarinaId: string;
  let categoryId: string;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "drizzle" });
    const [user] = await db.insert(users).values({ email: `pontili-${unique()}@test.example`, name: "Direzione", passwordHash: "x" }).returning({ id: users.id });
    marinaId = await db.transaction((tx) => createMarinaWithDefaults(tx, { name: `Porto ${unique()}`, userId: user.id, year: 2026 }));
    otherMarinaId = await db.transaction((tx) => createMarinaWithDefaults(tx, { name: `Altro ${unique()}`, userId: user.id, year: 2026 }));
    const [cat] = await db.select().from(berthCategories).where(eq(berthCategories.marinaId, marinaId)).limit(1);
    categoryId = cat.id;
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("sposta i posti con i contratti, tiene ogni pontile come tratto con la sua linea ed elimina quello unito", async () => {
    const [a, a2] = await db
      .insert(piers)
      .values([
        { marinaId, code: "M", name: "Molo", sortOrder: 0, planAx: 0, planAy: 0, planBx: 100, planBy: 0, planWidthM: 2 },
        { marinaId, code: "M2", name: "molo ", sortOrder: 1, planAx: 110, planAy: 0, planBx: 180, planBy: 0, planWidthM: 2 },
      ])
      .returning({ id: piers.id });
    await db.insert(berths).values([
      { marinaId, pierId: a.id, categoryId, code: "M01", side: "sx", position: 0, lengthCm: 800, beamCm: 300 },
      { marinaId, pierId: a2.id, categoryId, code: "M201", side: "sx", position: 0, lengthCm: 800, beamCm: 300 },
      { marinaId, pierId: a2.id, categoryId, code: "M202", side: "dx", position: 0, lengthCm: 800, beamCm: 300 },
    ]);
    const [moved] = await db.select({ id: berths.id }).from(berths).where(eq(berths.code, "M201"));
    const [owner] = await db.insert(owners).values({ marinaId, type: "persona", firstName: "Ada", lastName: "Molo", displayName: "Molo Ada" }).returning({ id: owners.id });
    const [boat] = await db.insert(boats).values({ marinaId, ownerId: owner.id, name: "Gamma", lengthCm: 700, beamCm: 280 }).returning({ id: boats.id });
    const [contract] = await db
      .insert(contracts)
      .values({ marinaId, year: 2026, ownerId: owner.id, boatId: boat.id, berthId: moved.id, type: "transito", status: "bozza", startDate: "2026-06-01", endDate: "2026-06-05", occupiedUntil: "2026-06-05", amountCents: 1000, vatRate: 22 })
      .returning({ id: contracts.id });
    const [list] = await db.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.marinaId, marinaId)).limit(1);
    if (list) await db.insert(rates).values({ marinaId, priceListId: list.id, categoryId, pierId: a2.id }).onConflictDoNothing();

    const result = await db.transaction((tx) => mergePiers(tx, marinaId, a.id, [a2.id]));
    expect(result.moved).toBe(2);

    const rows = await db.select().from(berths).where(eq(berths.pierId, a.id)).orderBy(asc(berths.code));
    expect(rows.map((b) => [b.code, b.side, b.position])).toEqual([
      ["M01", "sx", 0],
      ["M201", "sx", 1],
      ["M202", "dx", 0],
    ]);
    // Sulla pianta: un tratto per pontile di prima, con la sua linea e i suoi posti; il pontile non ha più una linea sua.
    const [target] = await db.select().from(piers).where(eq(piers.id, a.id));
    expect(target.planAx).toBeNull();
    const sections = await db.select().from(pierSections).where(eq(pierSections.pierId, a.id)).orderBy(asc(pierSections.sortOrder));
    expect(sections.map((x) => [x.label, x.planAx, x.planBx])).toEqual([
      ["M", 0, 100],
      ["M2", 110, 180],
    ]);
    const bySection = Object.fromEntries(rows.map((b) => [b.code, sections.find((x) => x.id === b.sectionId)?.label]));
    expect(bySection).toEqual({ M01: "M", M201: "M2", M202: "M2" });

    // Una seconda unione aggiunge un tratto e porta con sé quelli già esistenti.
    const [m3] = await db.insert(piers).values({ marinaId, code: "M3", name: "Molo", sortOrder: 2, planAx: 0, planAy: 50, planBx: 60, planBy: 50 }).returning({ id: piers.id });
    await db.insert(berths).values({ marinaId, pierId: m3.id, categoryId, code: "M301", side: "sx", position: 0, lengthCm: 800, beamCm: 300 });
    await db.transaction((tx) => mergePiers(tx, marinaId, a.id, [m3.id]));
    const after = await db.select().from(pierSections).where(eq(pierSections.pierId, a.id)).orderBy(asc(pierSections.sortOrder));
    expect(after.map((x) => x.label)).toEqual(["M", "M2", "M3"]);
    expect(await db.select().from(piers).where(eq(piers.id, a2.id))).toHaveLength(0);
    const [still] = await db.select({ berthId: contracts.berthId }).from(contracts).where(eq(contracts.id, contract.id));
    expect(still.berthId).toBe(moved.id);
  });

  it("i posti scelti diventano un tratto; i tratti rimasti vuoti spariscono", async () => {
    const [pier] = await db.insert(piers).values({ marinaId, code: "L", name: "Molo a L" }).returning({ id: piers.id });
    const made = await db
      .insert(berths)
      .values(["L01", "L02", "L03"].map((code, i) => ({ marinaId, pierId: pier.id, categoryId, code, position: i, lengthCm: 800, beamCm: 300 })))
      .returning({ id: berths.id, code: berths.code });
    const id = (code: string) => made.find((b) => b.code === code)!.id;
    await db.transaction((tx) => sectionFromBerths(tx, marinaId, pier.id, [id("L02"), id("L03")], "braccio"));
    let sections = await db.select().from(pierSections).where(eq(pierSections.pierId, pier.id));
    expect(sections.map((x) => x.label)).toEqual(["braccio"]);
    // Rifacendo il tratto con gli stessi posti, quello di prima resta vuoto e si elimina.
    await db.transaction((tx) => sectionFromBerths(tx, marinaId, pier.id, [id("L02"), id("L03")], "testata"));
    sections = await db.select().from(pierSections).where(eq(pierSections.pierId, pier.id));
    expect(sections.map((x) => x.label)).toEqual(["testata"]);
    const rows = await db.select({ code: berths.code, sectionId: berths.sectionId }).from(berths).where(eq(berths.pierId, pier.id)).orderBy(asc(berths.code));
    expect(rows.map((b) => b.sectionId === sections[0].id)).toEqual([false, true, true]);
    // Posti di un altro porto non contano.
    await expect(db.transaction((tx) => sectionFromBerths(tx, otherMarinaId, pier.id, [id("L01")], "x"))).rejects.toThrow(/non trovato/);
  });

  it("non unisce pontili di un altro porto", async () => {
    const [mine] = await db.insert(piers).values({ marinaId, code: "P", name: "Pontile" }).returning({ id: piers.id });
    const [theirs] = await db.insert(piers).values({ marinaId: otherMarinaId, code: "P", name: "Pontile" }).returning({ id: piers.id });
    await expect(db.transaction((tx) => mergePiers(tx, marinaId, mine.id, [theirs.id]))).rejects.toThrow(/non trovato/);
    expect(await db.select().from(piers).where(eq(piers.id, theirs.id))).toHaveLength(1);
  });
});

describe("nuovi codici dei posti", () => {
  const list = [
    { id: "s1", code: "CS01" },
    { id: "n10", code: "CN10" },
    { id: "n2", code: "CN2" },
    { id: "n1", code: "CN01" },
  ];

  it("rinumera in fila in ordine di codice naturale", async () => {
    const { renameCodes } = await import("@/lib/berth-codes");
    const r = renameCodes(list, " g ", { mode: "rinumera", from: 1 });
    expect(r).toEqual({
      ok: true,
      codes: [
        { id: "n1", code: "G01" },
        { id: "n2", code: "G02" },
        { id: "n10", code: "G03" },
        { id: "s1", code: "G04" },
      ],
    });
  });

  it("mantenendo i numeri rifiuta i doppioni e i codici senza numero", async () => {
    const { renameCodes } = await import("@/lib/berth-codes");
    expect(renameCodes(list, "G", { mode: "mantieni" })).toMatchObject({ ok: false, message: expect.stringMatching(/CN01 e CS01 diventerebbero entrambi G01/) });
    expect(renameCodes([{ id: "x", code: "CN07" }], "G", { mode: "mantieni" })).toEqual({ ok: true, codes: [{ id: "x", code: "G07" }] });
    expect(renameCodes([{ id: "x", code: "TESTA" }], "G", { mode: "mantieni" })).toMatchObject({ ok: false });
    expect(renameCodes(list, "  ", { mode: "mantieni" })).toMatchObject({ ok: false });
  });
});
