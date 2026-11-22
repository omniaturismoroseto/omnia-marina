import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { db } from "@/db";
import { berthCategories, berths, boats, contracts, owners, piers, priceLists, rates, users } from "@/db/schema";
import { appendPositions, mergeTraces, movedOrder, parseIdList } from "@/lib/pier-merge";
import { createMarinaWithDefaults } from "@/server/marina-setup";
import { mergePiers } from "@/server/piers";

describe("unione dei pontili: regole pure", () => {
  it("le linee in fila si allungano, quelle ad angolo no", () => {
    const a = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, widthM: 2 };
    const inLine = mergeTraces(a, { a: { x: 120, y: 2 }, b: { x: 200, y: 1 }, widthM: 3 });
    expect(inLine.aligned).toBe(true);
    expect(inLine.trace!.a).toEqual({ x: 0, y: 0 });
    expect(inLine.trace!.b.x).toBeCloseTo(200);
    expect(inLine.trace!.widthM).toBe(2);

    const corner = mergeTraces(a, { a: { x: 100, y: 0 }, b: { x: 100, y: 80 }, widthM: 2 });
    expect(corner.aligned).toBe(false);
    expect(corner.trace).toBe(a);

    expect(mergeTraces(null, a)).toEqual({ trace: a, aligned: true });
    expect(mergeTraces(a, null)).toEqual({ trace: a, aligned: true });
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

  it("sposta i posti con i contratti, allunga la linea ed elimina il pontile unito", async () => {
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
    expect(result.aligned).toBe(true);

    const rows = await db.select().from(berths).where(eq(berths.pierId, a.id)).orderBy(asc(berths.code));
    expect(rows.map((b) => [b.code, b.side, b.position])).toEqual([
      ["M01", "sx", 0],
      ["M201", "sx", 1],
      ["M202", "dx", 0],
    ]);
    const [target] = await db.select().from(piers).where(eq(piers.id, a.id));
    expect(target.planBx).toBeCloseTo(180);
    expect(await db.select().from(piers).where(eq(piers.id, a2.id))).toHaveLength(0);
    const [still] = await db.select({ berthId: contracts.berthId }).from(contracts).where(eq(contracts.id, contract.id));
    expect(still.berthId).toBe(moved.id);
  });

  it("non unisce pontili di un altro porto", async () => {
    const [mine] = await db.insert(piers).values({ marinaId, code: "P", name: "Pontile" }).returning({ id: piers.id });
    const [theirs] = await db.insert(piers).values({ marinaId: otherMarinaId, code: "P", name: "Pontile" }).returning({ id: piers.id });
    await expect(db.transaction((tx) => mergePiers(tx, marinaId, mine.id, [theirs.id]))).rejects.toThrow(/non trovato/);
    expect(await db.select().from(piers).where(eq(piers.id, theirs.id))).toHaveLength(1);
  });
});
