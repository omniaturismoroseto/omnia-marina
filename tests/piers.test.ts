import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { db } from "@/db";
import { berthCategories, berthModules, berths, boats, contracts, marinas, owners, pierSections, piers, priceLists, rates, users } from "@/db/schema";
import { appendPositions, movedOrder, parseIdList } from "@/lib/pier-merge";
import { planUnits, unitPositions } from "@/lib/plan-units";
import { createMarinaWithDefaults } from "@/server/marina-setup";
import { arrangeUnit, dissolveSection, flipNumbering, mergePiers, renameModule, sectionFromBerths, setModules, splitSection, splitUnitAt } from "@/server/piers";
import { byBerthCode } from "@/server/berth-order";
import { activeContractMessage, activeContractsOnBerths } from "@/server/contracts";

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

  it("riconosce i posti con un contratto attivo, che non cambiano codice", async () => {
    const [p] = await db.insert(piers).values({ marinaId, code: "KC", name: "Codici", sortOrder: 8 }).returning({ id: piers.id });
    const [busy, free, old] = await db
      .insert(berths)
      .values(
        ["KC1", "KC2", "KC3"].map((code, i) => ({ marinaId, pierId: p.id, categoryId, code, side: "sx" as const, position: i, lengthCm: 800, beamCm: 300 })),
      )
      .returning({ id: berths.id });
    const [owner] = await db.insert(owners).values({ marinaId, type: "persona", firstName: "Bo", lastName: "Kc", displayName: "Kc Bo" }).returning({ id: owners.id });
    const [boat] = await db.insert(boats).values({ marinaId, ownerId: owner.id, name: "Kappa", lengthCm: 700, beamCm: 280 }).returning({ id: boats.id });
    const base = { marinaId, year: 2026, ownerId: owner.id, boatId: boat.id, type: "transito" as const, amountCents: 1000, vatRate: 22 };
    await db.insert(contracts).values([
      { ...base, berthId: busy.id, status: "attivo", number: "2026/77", startDate: "2026-06-01", endDate: "2026-12-31", occupiedUntil: "2026-12-31" },
      // Concluso o già finito: il codice si può cambiare.
      { ...base, berthId: old.id, status: "attivo", startDate: "2026-01-01", endDate: "2026-01-05", occupiedUntil: "2026-01-05" },
      { ...base, berthId: free.id, status: "concluso", startDate: "2026-06-01", endDate: "2026-12-31", occupiedUntil: "2026-12-31" },
    ]);
    const active = await activeContractsOnBerths(db, marinaId, [busy.id, free.id, old.id], "2026-07-01");
    expect(active).toEqual([{ berthId: busy.id, code: "KC1", number: "2026/77" }]);
    expect(activeContractMessage(active)).toContain("Il posto KC1 ha un contratto attivo (contratto n. 2026/77)");
    // Un altro porto non vede i contratti di questo.
    expect(await activeContractsOnBerths(db, otherMarinaId, [busy.id], "2026-07-01")).toEqual([]);
  });

  it("unisce posti e moduli in un modulo solo o in uno esistente", async () => {
    const [p] = await db.insert(piers).values({ marinaId, code: "MU", name: "Moduli", sortOrder: 10 }).returning({ id: piers.id });
    const rows = await db
      .insert(berths)
      .values(["MU1", "MU2", "MU3", "MU4"].map((code, i) => ({ marinaId, pierId: p.id, categoryId, code, side: "sx" as const, position: i, lengthCm: 800, beamCm: 300 })))
      .returning({ id: berths.id });
    const ids = rows.map((r) => r.id);
    // Come li mostra la scheda: un modulo per posto (riconosciuti e non ancora salvati).
    const layout = ids.map((id, i) => ({ id, module: i + 1 }));
    await db.transaction((tx) => renameModule(tx, marinaId, p.id, [ids[3]], 4, "Testata"));
    const merged = await db.transaction((tx) => setModules(tx, marinaId, p.id, layout, ids.slice(0, 3), "new"));
    expect(merged).toEqual({ module: 5, count: 3 });
    let mods = (await db.select().from(berths).where(eq(berths.pierId, p.id)).orderBy(asc(berths.code))).map((b) => b.planModule);
    expect(mods).toEqual([5, 5, 5, 4]);
    // Nel modulo esistente «Testata»: il modulo 5 resta vuoto, il nome della testata resta.
    const now = ids.map((id, i) => ({ id, module: i < 3 ? 5 : 4 }));
    await db.transaction((tx) => setModules(tx, marinaId, p.id, now, ids.slice(0, 3), 4));
    mods = (await db.select().from(berths).where(eq(berths.pierId, p.id)).orderBy(asc(berths.code))).map((b) => b.planModule);
    expect(mods).toEqual([4, 4, 4, 4]);
    expect((await db.select().from(berthModules).where(eq(berthModules.pierId, p.id))).map((n) => n.name)).toEqual(["Testata"]);
    await expect(db.transaction((tx) => setModules(tx, marinaId, p.id, now, ids.slice(0, 1), 99))).rejects.toThrow(/non trovato/);
  });

  it("gira la numerazione (estremi e lati) anche sulla pianta e dà un nome al modulo", async () => {
    const [p] = await db
      .insert(piers)
      .values({ marinaId, code: "NR", name: "Numeri", sortOrder: 9, planAx: 0, planAy: 500, planBx: 300, planBy: 500, planWidthM: 2 })
      .returning({ id: piers.id });
    const rows = await db
      .insert(berths)
      .values(
        [0, 1, 2].flatMap((i) => [
          { marinaId, pierId: p.id, categoryId, code: `NR${i * 2 + 1}`, side: "sx" as const, position: i, lengthCm: 1000, beamCm: 400, planX: 50 + i * 100, planY: 440, planAngle: 0 },
          { marinaId, pierId: p.id, categoryId, code: `NR${i * 2 + 2}`, side: "dx" as const, position: i, lengthCm: 1000, beamCm: 400, planX: 50 + i * 100, planY: 560, planAngle: 0 },
        ]),
      )
      .returning({ id: berths.id, code: berths.code });
    const ids = rows.map((r) => r.id);
    const read = async () =>
      Object.fromEntries((await db.select().from(berths).where(eq(berths.pierId, p.id))).map((b) => [b.code, b]));

    await db.transaction((tx) => flipNumbering(tx, marinaId, p.id, ids, "estremi"));
    let now = await read();
    expect([now.NR1.side, now.NR1.position, now.NR5.position]).toEqual(["sx", 2, 0]);
    expect(now.NR1.planX).toBeCloseTo(250, 5);
    expect(now.NR1.planY).toBeCloseTo(440, 5);
    // La radice della linea va dove ora c'è il primo posto.
    const [line] = await db.select().from(piers).where(eq(piers.id, p.id));
    expect([line.planAx, line.planBx]).toEqual([300, 0]);

    await db.transaction((tx) => flipNumbering(tx, marinaId, p.id, ids, "lati"));
    now = await read();
    expect([now.NR1.side, now.NR2.side]).toEqual(["dx", "sx"]);
    expect(now.NR1.planY).toBeCloseTo(560, 5);

    // Posti di un altro porto: rifiutati.
    const [foreign] = await db.insert(piers).values({ marinaId: otherMarinaId, code: "X", name: "X", sortOrder: 0 }).returning({ id: piers.id });
    await expect(db.transaction((tx) => flipNumbering(tx, otherMarinaId, foreign.id, ids, "lati"))).rejects.toThrow();

    await db.transaction((tx) => renameModule(tx, marinaId, p.id, ids.slice(0, 2), 1, "Testata"));
    const names = await db.select().from(berthModules).where(eq(berthModules.pierId, p.id));
    expect(names.map((n) => [n.module, n.name, n.sectionId])).toEqual([[1, "Testata", null]]);
    now = await read();
    expect(now.NR1.planModule).toBe(1);
    await db.transaction((tx) => renameModule(tx, marinaId, p.id, ids.slice(0, 2), 1, ""));
    expect(await db.select().from(berthModules).where(eq(berthModules.pierId, p.id))).toEqual([]);
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
    const [moved] = await db.select({ id: berths.id }).from(berths).where(and(eq(berths.code, "M201"), eq(berths.marinaId, marinaId)));
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

  it("un tratto si ridispone, si separa in un pontile a sé o si toglie", async () => {
    const [x, y] = await db
      .insert(piers)
      .values([
        { marinaId, code: "X", name: "Molo X", sortOrder: 50, baseRate: false },
        { marinaId, code: "Y", name: "molo x", sortOrder: 51 },
      ])
      .returning({ id: piers.id });
    await db.insert(berths).values([
      ...["X01", "X02"].map((code, i) => ({ marinaId, pierId: x.id, categoryId, code, side: (i % 2 ? "dx" : "sx") as "sx" | "dx", position: 0, lengthCm: 800, beamCm: 300 })),
      ...["Y03", "Y01", "Y02"].map((code) => ({ marinaId, pierId: y.id, categoryId, code, side: "sx" as const, position: Number(code.slice(1)), lengthCm: 800, beamCm: 300 })),
    ]);
    const [list] = await db.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.marinaId, marinaId)).limit(1);
    if (list) await db.insert(rates).values({ marinaId, priceListId: list.id, categoryId, pierId: x.id, annual: 123400 }).onConflictDoNothing();
    await db.transaction((tx) => mergePiers(tx, marinaId, x.id, [y.id]));
    const [tratto] = await db.select().from(pierSections).where(and(eq(pierSections.pierId, x.id), eq(pierSections.label, "Y")));

    // Disposizione: tutti a destra, in ordine di codice, dopo i posti del primo tratto.
    await db.transaction((tx) => arrangeUnit(tx, marinaId, x.id, tratto.id, "dx"));
    const yRows = await db.select().from(berths).where(eq(berths.sectionId, tratto.id)).orderBy(asc(berths.code));
    expect(yRows.map((b) => [b.code, b.side, b.position])).toEqual([
      ["Y01", "dx", 1],
      ["Y02", "dx", 2],
      ["Y03", "dx", 3],
    ]);

    // Separa: nuovo pontile con i posti del tratto e gli stessi prezzi; al pontile di partenza resta un tratto solo, che si toglie.
    const split = await db.transaction((tx) => splitSection(tx, marinaId, tratto.id, { code: "Y", name: "Molo Y" }));
    expect(split.moved).toBe(3);
    const [yPier] = await db.select().from(piers).where(eq(piers.id, split.pierId));
    expect(yPier.baseRate).toBe(false);
    expect(yPier.sortOrder).toBe(51);
    const moved = await db.select().from(berths).where(eq(berths.pierId, split.pierId)).orderBy(asc(berths.code));
    expect(moved.map((b) => [b.code, b.position, b.sectionId])).toEqual([
      ["Y01", 0, null],
      ["Y02", 1, null],
      ["Y03", 2, null],
    ]);
    if (list) expect((await db.select().from(rates).where(eq(rates.pierId, split.pierId)))[0]?.annual).toBe(123400);
    expect(await db.select().from(pierSections).where(eq(pierSections.pierId, x.id))).toHaveLength(0);

    // Togli tratto (su un altro pontile unito): i posti restano, senza tratto.
    const [z] = await db.insert(piers).values({ marinaId, code: "Z", name: "Molo Z" }).returning({ id: piers.id });
    await db.insert(berths).values({ marinaId, pierId: z.id, categoryId, code: "Z01", lengthCm: 800, beamCm: 300 });
    const [w] = await db.insert(piers).values({ marinaId, code: "W", name: "molo z" }).returning({ id: piers.id });
    await db.insert(berths).values({ marinaId, pierId: w.id, categoryId, code: "W01", lengthCm: 800, beamCm: 300 });
    await db.transaction((tx) => mergePiers(tx, marinaId, z.id, [w.id]));
    const [wSection] = await db.select().from(pierSections).where(and(eq(pierSections.pierId, z.id), eq(pierSections.label, "W")));
    await db.transaction((tx) => dissolveSection(tx, marinaId, wSection.id));
    const [w01] = await db.select().from(berths).where(and(eq(berths.code, "W01"), eq(berths.marinaId, marinaId)));
    expect([w01.pierId, w01.sectionId]).toEqual([z.id, null]);
    // Un tratto di un altro porto non si tocca.
    const [zSection] = await db.select().from(pierSections).where(eq(pierSections.pierId, z.id));
    await expect(db.transaction((tx) => dissolveSection(tx, otherMarinaId, zSection.id))).rejects.toThrow(/non trovato/);
  });

  it("un tratto fatto dall'editor ha la sua linea e accorcia quella del pontile", async () => {
    await db.update(marinas).set({ planPxPerMeter: 10 }).where(eq(marinas.id, marinaId));
    const [pier] = await db.insert(piers).values({ marinaId, code: "Q", name: "Molo Q", planAx: 0, planAy: 100, planBx: 400, planBy: 100, planWidthM: 2 }).returning({ id: piers.id });
    // Una fila sul pontile (Q01–Q03) e, accanto, una fila staccata (Q04–Q05) più in basso.
    const made = await db
      .insert(berths)
      .values([
        { code: "Q01", x: 40, y: 40, side: "sx" as const, position: 0 },
        { code: "Q02", x: 80, y: 40, side: "sx" as const, position: 1 },
        { code: "Q03", x: 120, y: 40, side: "sx" as const, position: 2 },
        { code: "Q04", x: 200, y: 300, side: "sx" as const, position: 3 },
        { code: "Q05", x: 240, y: 300, side: "sx" as const, position: 4 },
      ].map((b) => ({ marinaId, pierId: pier.id, categoryId, code: b.code, side: b.side, position: b.position, lengthCm: 1000, beamCm: 400, planX: b.x, planY: b.y, planAngle: 0 })))
      .returning({ id: berths.id, code: berths.code });
    const ids = made.filter((b) => b.code === "Q04" || b.code === "Q05").map((b) => b.id);
    await db.transaction((tx) => sectionFromBerths(tx, marinaId, pier.id, ids, "fila sud"));
    const [sec] = await db.select().from(pierSections).where(eq(pierSections.pierId, pier.id));
    expect(sec.planAy).not.toBeNull();
    expect(sec.planAx).toBeCloseTo(180, 0);
    expect(sec.planBx).toBeCloseTo(260, 0);
    const [q] = await db.select().from(piers).where(eq(piers.id, pier.id));
    expect([q.planAx, q.planBx]).toEqual([20, 140]);
    await db.update(marinas).set({ planPxPerMeter: null }).where(eq(marinas.id, marinaId));
  });

  it("dividere un pontile lo lascia uno solo, con due tratti e gli stessi codici", async () => {
    const [pier] = await db.insert(piers).values({ marinaId, code: "D", name: "Molo D", baseRate: false }).returning({ id: piers.id });
    const made = await db
      .insert(berths)
      .values(["D1", "D2", "D3", "D10", "D11"].map((code, i) => ({ marinaId, pierId: pier.id, categoryId, code, position: i, lengthCm: 800, beamCm: 300 })))
      .returning({ id: berths.id, code: berths.code });
    const id = (code: string) => made.find((b) => b.code === code)!.id;
    // In ordine naturale D10 viene dopo D3: il secondo tratto parte da D10.
    const r = await db.transaction((tx) => splitUnitAt(tx, marinaId, pier.id, null, id("D10"), { first: "1", second: "2" }));
    expect(r).toEqual({ first: 3, second: 2 });
    const sections = await db.select().from(pierSections).where(eq(pierSections.pierId, pier.id)).orderBy(asc(pierSections.sortOrder));
    expect(sections.map((x) => x.label)).toEqual(["1", "2"]);
    const rows = await db.select({ code: berths.code, pierId: berths.pierId, sectionId: berths.sectionId, categoryId: berths.categoryId }).from(berths).where(eq(berths.pierId, pier.id)).orderBy(...byBerthCode);
    expect(rows.map((b) => b.code)).toEqual(["D1", "D2", "D3", "D10", "D11"]);
    expect(rows.map((b) => sections.find((x) => x.id === b.sectionId)?.label)).toEqual(["1", "1", "1", "2", "2"]);
    expect(new Set(rows.map((b) => b.categoryId))).toEqual(new Set([categoryId]));
    // Il primo posto non può aprire il secondo tratto.
    await expect(db.transaction((tx) => splitUnitAt(tx, marinaId, pier.id, sections[0].id, id("D1"), { first: "a", second: "b" }))).rejects.toThrow(/non il primo/);
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
        { id: "n1", code: "G1" },
        { id: "n2", code: "G2" },
        { id: "n10", code: "G3" },
        { id: "s1", code: "G4" },
      ],
    });
  });

  it("mantenendo i numeri rifiuta i doppioni e i codici senza numero", async () => {
    const { renameCodes } = await import("@/lib/berth-codes");
    expect(renameCodes(list, "G", { mode: "mantieni" })).toMatchObject({ ok: false, message: expect.stringMatching(/CN01 e CS01 diventerebbero entrambi G1/) });
    expect(renameCodes([{ id: "x", code: "CN07" }], "G", { mode: "mantieni" })).toEqual({ ok: true, codes: [{ id: "x", code: "G7" }] });
    expect(renameCodes([{ id: "x", code: "TESTA" }], "G", { mode: "mantieni" })).toMatchObject({ ok: false });
    expect(renameCodes(list, "  ", { mode: "mantieni" })).toMatchObject({ ok: false });
  });
});
