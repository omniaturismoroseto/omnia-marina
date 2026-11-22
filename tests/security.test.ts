// Controlli di sicurezza: freni ai tentativi, indirizzi delle notifiche, reimpostazione della password da parte della
// direzione e tentativi di attivazione dell'area diportista. Le parti con il database vengono saltate se manca.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { db } from "@/db";
import { auditLog, marinas, memberships, ownerAccess, ownerInvites, owners, users } from "@/db/schema";
import { visibleUser, withoutAccountManager } from "@/lib/account-manager";
import { verifyPassword } from "@/lib/auth/password";
import type { MarinaContext } from "@/lib/context";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { INVITE_MAX_FAILED } from "@/lib/owner-access";
import { createAccount } from "@/server/credentials";
import { createMarinaWithDefaults } from "@/server/marina-setup";
import { activateInvite, createInvite } from "@/server/owner-access";
import { isPushEndpoint } from "@/server/push";

// Le azioni chiedono la sessione a requireMarina: qui la sessione è quella preparata dal test.
let session: MarinaContext | null = null;
vi.mock("@/lib/context", async (original) => ({
  ...(await original<typeof import("@/lib/context")>()),
  requireMarina: async () => {
    if (!session) throw new Error("Nessuna sessione di prova");
    return session;
  },
  requireUser: async () => {
    if (!session) throw new Error("Nessuna sessione di prova");
    return session;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { addMember, changeMemberRole, resetMemberPassword } = await import("@/server/settings-actions");
const { createMarina } = await import("@/server/auth-actions");

describe("freno ai tentativi", () => {
  it("blocca dopo il massimo e riparte quando la finestra scade", () => {
    let now = 1_000;
    const limiter = createRateLimiter(3, 100, () => now);
    expect(limiter.blocked("a")).toBe(false);
    limiter.hit("a");
    limiter.hit("a");
    expect(limiter.blocked("a")).toBe(false);
    expect(limiter.hit("a")).toBe(3);
    expect(limiter.blocked("a")).toBe(true);
    expect(limiter.blocked("b")).toBe(false);
    now += 101;
    expect(limiter.blocked("a")).toBe(false);
    expect(limiter.hit("a")).toBe(1);
    limiter.hit("a");
    limiter.hit("a");
    limiter.clear("a");
    expect(limiter.blocked("a")).toBe(false);
  });

  it("usa l'ultimo indirizzo di X-Forwarded-For, quello aggiunto dal servizio di Google", () => {
    expect(clientIp("1.2.3.4, 5.6.7.8", null)).toBe("5.6.7.8");
    expect(clientIp(" 9.9.9.9 ", null)).toBe("9.9.9.9");
    expect(clientIp(null, "10.0.0.1")).toBe("10.0.0.1");
    expect(clientIp("", null)).toBe("sconosciuto");
  });
});

describe("indirizzi delle notifiche", () => {
  it("accetta solo i servizi push dei browser", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QH8abc")).toBe(true);
    expect(isPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=abc")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("https://10.0.0.1/push")).toBe(false);
    expect(isPushEndpoint("https://metadata.google.internal/computeMetadata/v1/")).toBe(false);
    expect(isPushEndpoint("non un indirizzo")).toBe(false);
  });
});

// ───────────────────────── Con database ─────────────────────────

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

const hasDb = !process.env.FIREBASE_PROJECT_ID && (await databaseAvailable());
const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const FISCAL = "BNCLRA85M41F205Z";

describe.skipIf(!hasDb)("account di altri porti (database, password locali)", () => {
  let homeMarinaId: string;
  let attackerMarinaId: string;
  let attackerId: string;
  let ownerId: string;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "drizzle" });
    const staffId = await createAccount(db, { email: `ufficio-${unique()}@test.example`, name: "Ufficio", password: "password-ufficio" });
    homeMarinaId = await db.transaction((tx) => createMarinaWithDefaults(tx, { name: `Porto ${unique()}`, userId: staffId, year: 2026 }));
    attackerId = await createAccount(db, { email: `altro-${unique()}@test.example`, name: "Altro porto", password: "password-altro" });
    attackerMarinaId = await db.transaction((tx) => createMarinaWithDefaults(tx, { name: `Altro ${unique()}`, userId: attackerId, year: 2026 }));
    const [owner] = await db
      .insert(owners)
      .values({ marinaId: homeMarinaId, type: "persona", firstName: "Laura", lastName: "Bianchi", displayName: "Bianchi Laura", fiscalCode: FISCAL })
      .returning({ id: owners.id });
    ownerId = owner.id;
    session = {
      sessionId: "sessione-di-prova",
      user: { id: attackerId, name: "Altro porto", email: "altro@test.example" },
      accountManager: false,
      memberships: [],
      ownerAreas: [],
      activeMarinaId: attackerMarinaId,
      activeOwnerAccessId: null,
      marinaId: attackerMarinaId,
      marinaName: "Altro",
      role: "admin",
    };
  });

  afterAll(() => {
    session = null;
  });

  it("la direzione di un altro porto non può cambiare la password di un diportista collegato con la sola email", async () => {
    const email = `diportista-${unique()}@test.example`;
    const boaterId = await createAccount(db, { email, name: "Laura", password: "password-giusta" });
    await db.insert(ownerAccess).values({ marinaId: homeMarinaId, ownerId, userId: boaterId });
    // L'altro porto collega l'account (basta conoscere l'email) e prova a reimpostarne la password.
    const [m] = await db.insert(memberships).values({ userId: boaterId, marinaId: attackerMarinaId, role: "banchina" }).returning({ id: memberships.id });
    const form = new FormData();
    form.set("membershipId", m.id);
    form.set("password", "password-dell-intruso");
    const state = await resetMemberPassword(undefined, form);
    expect(state?.ok).not.toBe(true);
    expect(state?.message).toContain("diportista");
    const [user] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, boaterId));
    expect(await verifyPassword("password-giusta", user.hash!)).toBe(true);
  });

  it("la password di chi lavora solo in questo porto si reimposta", async () => {
    const email = `banchina-${unique()}@test.example`;
    const workerId = await createAccount(db, { email, name: "Banchina", password: "password-vecchia" });
    const [m] = await db.insert(memberships).values({ userId: workerId, marinaId: attackerMarinaId, role: "banchina" }).returning({ id: memberships.id });
    const form = new FormData();
    form.set("membershipId", m.id);
    form.set("password", "password-nuova-1");
    expect((await resetMemberPassword(undefined, form))?.ok).toBe(true);
    const [user] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, workerId));
    expect(await verifyPassword("password-nuova-1", user.hash!)).toBe(true);
  });

  it("un identificativo manomesso non fa fallire l'azione", async () => {
    const form = new FormData();
    form.set("membershipId", "non-un-id");
    form.set("password", "password-nuova-1");
    expect((await resetMemberPassword(undefined, form))?.message).toBe("Controlla i campi evidenziati.");
  });

  it("all'attivazione le password sbagliate di un account esistente consumano i tentativi dell'invito", async () => {
    const email = `esistente-${unique()}@test.example`;
    await createAccount(db, { email, name: "Esistente", password: "password-segreta" });
    const inviteId = await createInvite({ marinaId: homeMarinaId, user: { id: attackerId } }, ownerId, "Laura");
    const [{ code }] = await db.select({ code: ownerInvites.code }).from(ownerInvites).where(eq(ownerInvites.id, inviteId));
    for (let i = 0; i < INVITE_MAX_FAILED; i++) {
      const r = await activateInvite({ code, taxId: FISCAL, email, password: `tentativo-${i}-xxxx` });
      expect(r.ok).toBe(false);
    }
    // Ora anche la password giusta non passa più: il codice è bloccato.
    const blocked = await activateInvite({ code, taxId: FISCAL, email, password: "password-segreta" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toContain("bloccato");
  });
});

describe.skipIf(!hasDb)("account manager (database, password locali)", () => {
  const managerEmail = `manager-${unique()}@test.example`;
  let managerId: string;
  let directorId: string;
  let marinaId: string;
  const managerSession = (): MarinaContext => ({
    sessionId: "sessione-manager",
    user: { id: managerId, name: "Account manager", email: managerEmail },
    accountManager: true,
    memberships: [],
    ownerAreas: [],
    activeMarinaId: marinaId,
    activeOwnerAccessId: null,
    marinaId,
    marinaName: "Porto",
    role: "admin",
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "drizzle" });
    // L'account esiste prima che l'email diventi quella dell'account manager (come in produzione).
    managerId = await createAccount(db, { email: managerEmail, name: "Account manager", password: "password-manager" });
    process.env.ACCOUNT_MANAGER_EMAILS = ` altro@test.example , ${managerEmail.toUpperCase()} `;
  });

  afterAll(() => {
    delete process.env.ACCOUNT_MANAGER_EMAILS;
    session = null;
  });

  it("nessuno può creare un nuovo account con l'email dell'account manager", async () => {
    await expect(createAccount(db, { email: "altro@test.example", name: "Intruso", password: "password-intruso" })).rejects.toThrow();
  });

  it("solo l'account manager crea un porto, con il suo direttore", async () => {
    const directorEmail = `direttore-${unique()}@test.example`;
    const form = new FormData();
    form.set("marinaName", `Porto ${unique()}`);
    form.set("directorName", "Direttore");
    form.set("directorEmail", directorEmail);
    form.set("password", "password-direttore");

    session = { ...managerSession(), accountManager: false };
    expect((await createMarina(undefined, form))?.ok).not.toBe(true);

    session = managerSession();
    const state = await createMarina(undefined, form);
    expect(state?.ok).toBe(true);
    const [director] = await db.select({ id: users.id }).from(users).where(eq(users.email, directorEmail));
    directorId = director.id;
    const [m] = await db.select({ marinaId: memberships.marinaId, role: memberships.role }).from(memberships).where(eq(memberships.userId, directorId));
    expect(m.role).toBe("admin");
    marinaId = m.marinaId;
    // L'account manager non diventa membro del porto: ci entra comunque.
    const own = await db.select().from(memberships).where(and(eq(memberships.userId, managerId), eq(memberships.marinaId, marinaId)));
    expect(own).toHaveLength(0);
    const [port] = await db.select({ id: marinas.id }).from(marinas).where(eq(marinas.id, marinaId));
    expect(port).toBeDefined();
  });

  it("la direzione non vede l'account manager tra gli utenti e non può aggiungerlo né cambiarlo", async () => {
    // Anche se l'account manager fosse rimasto membro di un porto (come prima di questa funzione).
    const [m] = await db.insert(memberships).values({ userId: managerId, marinaId, role: "admin" }).returning({ id: memberships.id });
    session = { ...managerSession(), user: { id: directorId, name: "Direttore", email: "direttore@test.example" }, accountManager: false };

    const role = new FormData();
    role.set("membershipId", m.id);
    role.set("role", "banchina");
    expect((await changeMemberRole(undefined, role))?.message).toBe("Utente non trovato.");

    const add = new FormData();
    add.set("name", "Chiunque");
    add.set("email", managerEmail);
    add.set("role", "ufficio");
    add.set("password", "password-qualsiasi");
    expect((await addMember(undefined, add))?.errors?.email).toBeDefined();

    // Il direttore resta l'unica direzione del porto: non può togliersi il ruolo contando sull'account manager.
    const [mine] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, directorId), eq(memberships.marinaId, marinaId)));
    const demote = new FormData();
    demote.set("membershipId", mine.id);
    demote.set("role", "ufficio");
    expect((await changeMemberRole(undefined, demote))?.message).toContain("almeno una persona");
  });

  it("nel registro e accanto alle modifiche il nome dell'account manager non compare", async () => {
    await db.insert(auditLog).values([
      { marinaId, userId: managerId, action: "modifica", entity: "porto", summary: "dal manager" },
      { marinaId, userId: directorId, action: "modifica", entity: "porto", summary: "dal direttore" },
      { marinaId, userId: null, action: "invio automatico", entity: "messaggio", summary: "dal sistema" },
    ]);
    const shown = await db
      .select({ summary: auditLog.summary })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(and(eq(auditLog.marinaId, marinaId), withoutAccountManager()));
    const summaries = shown.map((r) => r.summary);
    expect(summaries).toContain("dal direttore");
    expect(summaries).toContain("dal sistema");
    expect(summaries).not.toContain("dal manager");

    const names = await db
      .select({ name: users.name })
      .from(auditLog)
      .leftJoin(users, and(eq(users.id, auditLog.userId), visibleUser()))
      .where(and(eq(auditLog.marinaId, marinaId), eq(auditLog.summary, "dal manager")));
    expect(names[0].name).toBeNull();
  });
});
