import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { db } from "@/db";
import {
  berthCategories,
  berthModules,
  berths,
  marinas,
  pierSections,
  piers,
  settingsHistory,
  users,
} from "@/db/schema";
import { createMarinaWithDefaults } from "@/server/marina-setup";
import { flipNumbering, sectionFromBerths } from "@/server/piers";
import {
  historyState,
  stepHistory,
  withMarinaHistory,
  withPierHistory,
} from "@/server/settings-history";

async function databaseAvailable(): Promise<boolean> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
  });
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

describe.skipIf(!hasDb)(
  "Indietro e Avanti delle modifiche salvate (database)",
  () => {
    let marinaId: string;
    let otherMarinaId: string;
    let userId: string;
    let categoryId: string;
    const actor = () => ({ marinaId, userId });

    beforeAll(async () => {
      await migrate(db, { migrationsFolder: "drizzle" });
      const [user] = await db
        .insert(users)
        .values({
          email: `storico-${unique()}@test.example`,
          name: "Direzione",
          passwordHash: "x",
        })
        .returning({ id: users.id });
      userId = user.id;
      marinaId = await db.transaction((tx) =>
        createMarinaWithDefaults(tx, {
          name: `Porto ${unique()}`,
          userId,
          year: 2026,
        }),
      );
      otherMarinaId = await db.transaction((tx) =>
        createMarinaWithDefaults(tx, {
          name: `Altro ${unique()}`,
          userId,
          year: 2026,
        }),
      );
      const [cat] = await db
        .select()
        .from(berthCategories)
        .where(eq(berthCategories.marinaId, marinaId))
        .limit(1);
      categoryId = cat.id;
    });

    afterAll(async () => {
      await db.$client.end();
    });

    async function newPier(code: string) {
      const [p] = await db
        .insert(piers)
        .values({
          marinaId,
          code,
          name: code,
          sortOrder: 0,
          planAx: 0,
          planAy: 500,
          planBx: 300,
          planBy: 500,
          planWidthM: 2,
        })
        .returning({ id: piers.id });
      const rows = await db
        .insert(berths)
        .values(
          [0, 1, 2].map((i) => ({
            marinaId,
            pierId: p.id,
            categoryId,
            code: `${code}${i + 1}`,
            side: "sx" as const,
            position: i,
            lengthCm: 1000,
            beamCm: 400,
            planX: 50 + i * 100,
            planY: 440,
            planAngle: 0,
          })),
        )
        .returning({ id: berths.id });
      return { pierId: p.id, ids: rows.map((r) => r.id) };
    }
    const read = async (pierId: string) =>
      (
        await db
          .select()
          .from(berths)
          .where(eq(berths.pierId, pierId))
          .orderBy(asc(berths.code))
      ).map((b) => [
        b.code,
        b.position,
        b.sectionId !== null,
        Math.round(b.planX ?? 0),
      ]);

    it("annulla e rifà la numerazione girata e il tratto, una modifica alla volta", async () => {
      const { pierId, ids } = await newPier("UN");
      const start = await read(pierId);
      await db.transaction((tx) =>
        withPierHistory(tx, actor(), pierId, "Numerazione", () =>
          flipNumbering(tx, marinaId, pierId, ids, "estremi"),
        ),
      );
      const flipped = await read(pierId);
      expect(flipped).not.toEqual(start);
      await db.transaction((tx) =>
        withPierHistory(tx, actor(), pierId, "Dividi", () =>
          sectionFromBerths(tx, marinaId, pierId, ids.slice(0, 2), "T"),
        ),
      );
      const divided = await read(pierId);
      expect(
        (await historyState(marinaId, "pontile", [pierId]))[pierId],
      ).toMatchObject({ undo: "Dividi", redo: null });

      expect(
        await db.transaction((tx) =>
          stepHistory(tx, actor(), "pontile", pierId, false),
        ),
      ).toBe("Dividi");
      expect(await read(pierId)).toEqual(flipped);
      expect(
        await db
          .select()
          .from(pierSections)
          .where(eq(pierSections.pierId, pierId)),
      ).toEqual([]);
      expect(
        await db.transaction((tx) =>
          stepHistory(tx, actor(), "pontile", pierId, false),
        ),
      ).toBe("Numerazione");
      expect(await read(pierId)).toEqual(start);
      const [line] = await db.select().from(piers).where(eq(piers.id, pierId));
      expect([line.planAx, line.planBx]).toEqual([0, 300]);
      await expect(
        db.transaction((tx) =>
          stepHistory(tx, actor(), "pontile", pierId, false),
        ),
      ).rejects.toThrow(/niente da annullare/);
      expect(
        (await historyState(marinaId, "pontile", [pierId]))[pierId],
      ).toMatchObject({ undo: null, redo: "Numerazione" });

      // Avanti: nello stesso ordine.
      expect(
        await db.transaction((tx) =>
          stepHistory(tx, actor(), "pontile", pierId, true),
        ),
      ).toBe("Numerazione");
      expect(await read(pierId)).toEqual(flipped);
      expect(
        await db.transaction((tx) =>
          stepHistory(tx, actor(), "pontile", pierId, true),
        ),
      ).toBe("Dividi");
      expect(await read(pierId)).toEqual(divided);
      expect(
        (
          await db
            .select()
            .from(pierSections)
            .where(eq(pierSections.pierId, pierId))
        ).map((s) => s.label),
      ).toEqual(["T"]);
    });

    it("una modifica nuova toglie «Avanti»; dopo un cambio esterno non si annulla", async () => {
      const { pierId, ids } = await newPier("EX");
      await db.transaction((tx) =>
        withPierHistory(tx, actor(), pierId, "Lati", () =>
          flipNumbering(tx, marinaId, pierId, ids, "lati"),
        ),
      );
      await db.transaction((tx) =>
        stepHistory(tx, actor(), "pontile", pierId, false),
      );
      await db.transaction((tx) =>
        withPierHistory(tx, actor(), pierId, "Estremi", () =>
          flipNumbering(tx, marinaId, pierId, ids, "estremi"),
        ),
      );
      expect(
        (await historyState(marinaId, "pontile", [pierId]))[pierId],
      ).toMatchObject({ undo: "Estremi", redo: null });
      // Un posto spostato dalla mappa (senza storico): «Indietro» si rifiuta, non rovescia la modifica dell'altro.
      await db.update(berths).set({ planX: 999 }).where(eq(berths.id, ids[0]));
      await expect(
        db.transaction((tx) =>
          stepHistory(tx, actor(), "pontile", pierId, false),
        ),
      ).rejects.toThrow(/è cambiato qualcos'altro/);
      // Un altro porto non vede né tocca lo storico.
      await expect(
        db.transaction((tx) =>
          stepHistory(
            tx,
            { marinaId: otherMarinaId, userId },
            "pontile",
            pierId,
            false,
          ),
        ),
      ).rejects.toThrow(/niente da annullare/);
    });

    it("i nomi dei moduli tornano com'erano", async () => {
      const { pierId } = await newPier("NM");
      await db
        .insert(berthModules)
        .values({
          marinaId,
          pierId,
          sectionId: null,
          module: 1,
          name: "Testata",
        });
      await db.transaction((tx) =>
        withPierHistory(tx, actor(), pierId, "Nome", () =>
          tx.delete(berthModules).where(eq(berthModules.pierId, pierId)),
        ),
      );
      await db.transaction((tx) =>
        stepHistory(tx, actor(), "pontile", pierId, false),
      );
      expect(
        (
          await db
            .select()
            .from(berthModules)
            .where(eq(berthModules.pierId, pierId))
        ).map((m) => m.name),
      ).toEqual(["Testata"]);
    });

    it("impostazioni del porto: indietro e avanti, niente storico se non cambia nulla", async () => {
      const [before] = await db
        .select({ name: marinas.name, terms: marinas.contractTerms })
        .from(marinas)
        .where(eq(marinas.id, marinaId));
      const keys = ["name", "contractTerms", "contractTexts"];
      await db.transaction((tx) =>
        withMarinaHistory(tx, actor(), "Dati del porto", keys, () =>
          tx
            .update(marinas)
            .set({ name: "Porto nuovo", contractTexts: { title: "Patto" } })
            .where(eq(marinas.id, marinaId)),
        ),
      );
      await db.transaction((tx) =>
        withMarinaHistory(tx, actor(), "Uguale", keys, () =>
          tx
            .update(marinas)
            .set({ name: "Porto nuovo" })
            .where(eq(marinas.id, marinaId)),
        ),
      );
      expect(
        (await historyState(marinaId, "porto", [marinaId]))[marinaId],
      ).toMatchObject({ undo: "Dati del porto", redo: null });
      await db.transaction((tx) =>
        stepHistory(tx, actor(), "porto", marinaId, false),
      );
      const [now] = await db
        .select()
        .from(marinas)
        .where(eq(marinas.id, marinaId));
      expect([now.name, now.contractTerms]).toEqual([
        before.name,
        before.terms,
      ]);
      await db.transaction((tx) =>
        stepHistory(tx, actor(), "porto", marinaId, true),
      );
      const [again] = await db
        .select()
        .from(marinas)
        .where(eq(marinas.id, marinaId));
      expect([again.name, again.contractTexts]).toEqual([
        "Porto nuovo",
        { title: "Patto" },
      ]);
      expect(
        (
          await db
            .select()
            .from(settingsHistory)
            .where(eq(settingsHistory.targetId, marinaId))
        ).length,
      ).toBe(1);
    });
  },
);
