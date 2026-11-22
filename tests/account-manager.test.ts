// Account manager che prova i porti con un ruolo scelto o come diportista di un cliente. La sessione è finta;
// porti e clienti stanno nel database di test (senza, i test vengono saltati).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { db } from "@/db";
import { owners, users } from "@/db/schema";
import type { SessionInfo } from "@/lib/auth/session";

let session: SessionInfo | null = null;
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  getSession: async () => session,
}));
// redirect() di Next interrompe la richiesta: qui diventa un errore che dice dove si andava.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const { requireMarina, requireOwner, OFFICE } = await import("@/lib/context");
const { createMarinaWithDefaults } = await import("@/server/marina-setup");

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

describe.skipIf(!hasDb)("account manager: prove con un ruolo o come diportista", () => {
  const managerEmail = `manager-${unique()}@test.example`;
  let managerId: string;
  let otherId: string;
  let marinaId: string;
  let ownerId: string;
  const as = (userId: string, email: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
    sessionId: `s-${unique()}`,
    marinaId,
    ownerAccessId: null,
    previewRole: null,
    previewOwnerId: null,
    user: { id: userId, name: "Persona", email },
    ...extra,
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "drizzle" });
    [{ id: managerId }] = await db.insert(users).values({ email: managerEmail, name: "Manager", passwordHash: "x" }).returning({ id: users.id });
    const otherEmail = `direttore-${unique()}@test.example`;
    [{ id: otherId }] = await db.insert(users).values({ email: otherEmail, name: "Direttore", passwordHash: "x" }).returning({ id: users.id });
    marinaId = await db.transaction((tx) => createMarinaWithDefaults(tx, { name: `Porto ${unique()}`, userId: otherId, year: 2026 }));
    [{ id: ownerId }] = await db.insert(owners).values({ marinaId, displayName: "Cliente di prova" }).returning({ id: owners.id });
    process.env.ACCOUNT_MANAGER_EMAILS = managerEmail;
  });

  afterAll(() => {
    delete process.env.ACCOUNT_MANAGER_EMAILS;
    session = null;
  });

  it("senza ruolo scelto entra come Direzione, in un porto di cui non è membro", async () => {
    session = as(managerId, managerEmail);
    const ctx = await requireMarina(["admin"]);
    expect(ctx.role).toBe("admin");
    expect(ctx.marinaId).toBe(marinaId);
  });

  it("con il ruolo Banchina vede il porto come la banchina: le pagine dell'ufficio lo rimandano alla sua home", async () => {
    session = as(managerId, managerEmail, { previewRole: "banchina" });
    expect((await requireMarina()).role).toBe("banchina");
    await expect(requireMarina(OFFICE)).rejects.toThrow("redirect:/banchina");
  });

  it("come diportista vede l'area del cliente scelto, senza un accesso del cliente", async () => {
    session = as(managerId, managerEmail, { previewOwnerId: ownerId });
    const ctx = await requireOwner();
    expect(ctx.preview).toBe(true);
    expect(ctx.ownerId).toBe(ownerId);
    expect(ctx.marinaId).toBe(marinaId);
    // e intanto il gestionale non si apre
    await expect(requireMarina()).rejects.toThrow("redirect:/diportista");
  });

  it("per chi non è account manager ruolo e cliente di prova non contano", async () => {
    session = as(otherId, "direttore@test.example", { previewRole: "banchina", previewOwnerId: ownerId });
    expect((await requireMarina(["admin"])).role).toBe("admin");
    await expect(requireOwner()).rejects.toThrow("redirect:/porti");
  });
});
