// Area diportista: funzioni pure (codici, codice fiscale, messaggio) e, con database ed emulatore di Firebase
// Authentication, inviti, attivazione e revoca. Senza database o emulatore quei test vengono saltati.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { db } from "@/db";
import { ownerAccess, ownerInvites, owners, sessions, users } from "@/db/schema";
import {
  INVITE_ALPHABET,
  canInvite,
  formatInviteCode,
  inviteCodeFromBytes,
  inviteMessage,
  normalizeInviteCode,
  normalizeTaxId,
  taxIdMatches,
  whatsappUrl,
} from "@/lib/owner-access";
import { createAccount } from "@/server/credentials";
import { createMarinaWithDefaults } from "@/server/marina-setup";
import { activateInvite, cancelInvite, createInvite, renewInvite, revokeAccess } from "@/server/owner-access";

const PROJECT = "demo-omnia";
const EMULATOR = process.env.TEST_FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

describe("codici d'invito", () => {
  it("usa solo caratteri non ambigui e si normalizza", () => {
    const code = inviteCodeFromBytes(new Uint8Array([0, 1, 2, 31, 32, 63, 200, 255]));
    expect(code).toHaveLength(8);
    expect([...code].every((c) => INVITE_ALPHABET.includes(c))).toBe(true);
    expect(INVITE_ALPHABET).not.toMatch(/[01OI]/);
    expect(formatInviteCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(normalizeInviteCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizeInviteCode("ABCD EFG")).toBeNull();
    expect(normalizeInviteCode("ABCD-EFG0")).toBeNull();
  });
});

describe("seconda prova", () => {
  const person = { fiscalCode: "RSSMRA80A01H501U", vatNumber: null };
  const company = { fiscalCode: null, vatNumber: "IT01234567890" };
  it("confronta codice fiscale e partita IVA scritti in qualsiasi modo", () => {
    expect(taxIdMatches("rssmra 80a01 h501u", person)).toBe(true);
    expect(taxIdMatches("RSSMRA80A01H501X", person)).toBe(false);
    expect(taxIdMatches("01234567890", company)).toBe(true);
    expect(taxIdMatches("IT 01234567890", company)).toBe(true);
    expect(taxIdMatches("", company)).toBe(false);
    expect(normalizeTaxId("IT01234567890")).toBe("01234567890");
  });
  it("senza codice fiscale né partita IVA non si invita", () => {
    expect(canInvite(person)).toBe(true);
    expect(canInvite({ fiscalCode: null, vatNumber: null })).toBe(false);
    expect(canInvite({ fiscalCode: "123", vatNumber: null })).toBe(false);
  });
});

describe("messaggio d'invito", () => {
  it("contiene collegamento, codice e scadenza", () => {
    const text = inviteMessage({ personName: "Marco", marinaName: "Marina X", url: "https://app/attiva/ABCDEFGH", code: "ABCDEFGH", expiresOn: "17/12/2026", company: false });
    expect(text).toContain("https://app/attiva/ABCDEFGH");
    expect(text).toContain("ABCD-EFGH");
    expect(text).toContain("17/12/2026");
    expect(text).toContain("codice fiscale");
  });
  it("apre WhatsApp con il numero, se c'è", () => {
    expect(whatsappUrl("333 1234567", "ciao")).toBe("https://wa.me/393331234567?text=ciao");
    expect(whatsappUrl("+39 333 1234567", "ciao")).toBe("https://wa.me/393331234567?text=ciao");
    expect(whatsappUrl(null, "a b")).toBe("https://wa.me/?text=a%20b");
  });
});

// ───────────────────────── Con database ed emulatore ─────────────────────────

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

async function emulatorAvailable(): Promise<boolean> {
  try {
    return (await fetch(`http://${EMULATOR}/`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

const ready = (await databaseAvailable()) && (await emulatorAvailable());
const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Conferma l'email direttamente nell'emulatore, come se il diportista avesse aperto il collegamento.
async function confirmEmail(userId: string) {
  const { getAuth } = await import("firebase-admin/auth");
  const { getApps } = await import("firebase-admin/app");
  await getAuth(getApps()[0]).updateUser(userId, { emailVerified: true });
}

async function sentVerifications(email: string): Promise<number> {
  const res = await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const { oobCodes } = (await res.json()) as { oobCodes: { email: string; requestType: string }[] };
  return oobCodes.filter((c) => c.email === email && c.requestType === "VERIFY_EMAIL").length;
}

describe.skipIf(!ready)("inviti e attivazione (database + emulatore)", () => {
  let marinaId: string;
  let otherMarinaId: string;
  let staffId: string;
  let ownerId: string;
  const FISCAL = "BNCLRA85M41F205Z";
  const actor = () => ({ marinaId, user: { id: staffId } });

  beforeAll(async () => {
    process.env.FIREBASE_PROJECT_ID = PROJECT;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = EMULATOR;
    await migrate(db, { migrationsFolder: "drizzle" });
    staffId = await createAccount(db, { email: `staff-${unique()}@test.example`, name: "Ufficio", password: "password-ufficio" });
    marinaId = await db.transaction((tx) => createMarinaWithDefaults(tx, { name: `Porto ${unique()}`, userId: staffId, year: 2026 }));
    otherMarinaId = await db.transaction((tx) => createMarinaWithDefaults(tx, { name: `Altro ${unique()}`, userId: staffId, year: 2026 }));
    const [owner] = await db
      .insert(owners)
      .values({ marinaId, type: "persona", firstName: "Laura", lastName: "Bianchi", displayName: "Bianchi Laura", fiscalCode: FISCAL })
      .returning({ id: owners.id });
    ownerId = owner.id;
  });

  afterAll(() => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  });

  async function inviteCode(id: string) {
    const [row] = await db.select({ code: ownerInvites.code }).from(ownerInvites).where(eq(ownerInvites.id, id));
    return row.code;
  }

  it("non invita senza codice fiscale e non tocca clienti di altri porti", async () => {
    const [noTax] = await db.insert(owners).values({ marinaId, type: "persona", displayName: "Senza Codici" }).returning({ id: owners.id });
    await expect(createInvite(actor(), noTax.id, "Senza Codici")).rejects.toThrow(/codice fiscale/);
    await expect(createInvite({ marinaId: otherMarinaId, user: { id: staffId } }, ownerId, "Laura")).rejects.toThrow(/non trovato/);
  });

  it("attiva un nuovo account: email da confermare, invito consumato", async () => {
    const inviteId = await createInvite(actor(), ownerId, "Laura Bianchi");
    const code = await inviteCode(inviteId);
    const email = `laura-${unique()}@test.example`;

    // Codice fiscale sbagliato: errore generico e un tentativo in più.
    const wrong = await activateInvite({ code, taxId: "RSSMRA80A01H501U", email, password: "password-laura" });
    expect(wrong).toMatchObject({ ok: false, field: "taxId" });
    expect((await db.select().from(ownerInvites).where(eq(ownerInvites.id, inviteId)))[0].failedAttempts).toBe(1);

    const done = await activateInvite({ code: formatInviteCode(code).toLowerCase(), taxId: "bnclra 85m41 f205z", email, password: "password-laura" });
    expect(done).toMatchObject({ ok: true, emailVerified: false, verificationSent: true, marinaId });
    expect(await sentVerifications(email)).toBe(1);
    expect(await db.select().from(ownerInvites).where(eq(ownerInvites.id, inviteId))).toHaveLength(0);

    // Lo stesso codice non vale una seconda volta.
    expect(await activateInvite({ code, taxId: FISCAL, email: `altro-${unique()}@test.example`, password: "password-altro" })).toMatchObject({ ok: false, field: "code" });

    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user.name).toBe("Laura Bianchi");
    const [access] = await db.select().from(ownerAccess).where(and(eq(ownerAccess.ownerId, ownerId), eq(ownerAccess.userId, user.id)));
    expect(access.revokedAt).toBeNull();
  });

  it("collega un account esistente solo con la sua password", async () => {
    const email = `skipper-${unique()}@test.example`;
    const userId = await createAccount(db, { email, name: "Skipper", password: "password-skipper" });
    await confirmEmail(userId);
    const code = await inviteCode(await createInvite(actor(), ownerId, "Skipper"));

    expect(await activateInvite({ code, taxId: FISCAL, email, password: "password-sbagliata" })).toMatchObject({ ok: false, field: "password" });
    const done = await activateInvite({ code, taxId: FISCAL, email, password: "password-skipper" });
    expect(done).toMatchObject({ ok: true, userId, emailVerified: true, verificationSent: false });
  });

  it("si blocca dopo troppi tentativi; nuovo codice e annullamento", async () => {
    const inviteId = await createInvite(actor(), ownerId, "Tentativi");
    const code = await inviteCode(inviteId);
    for (let i = 0; i < 5; i++) await activateInvite({ code, taxId: "XXXXXXXXXXXXXXXX", email: `t-${unique()}@test.example`, password: "password-tentativo" });
    expect(await activateInvite({ code, taxId: FISCAL, email: `t-${unique()}@test.example`, password: "password-tentativo" })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/bloccato/),
    });

    await renewInvite(actor(), inviteId);
    const fresh = await inviteCode(inviteId);
    expect(fresh).not.toBe(code);
    expect(await activateInvite({ code, taxId: FISCAL, email: `t-${unique()}@test.example`, password: "password-tentativo" })).toMatchObject({ ok: false, field: "code" });

    await expect(cancelInvite({ marinaId: otherMarinaId, user: { id: staffId } }, inviteId)).rejects.toThrow(/non trovato/);
    await cancelInvite(actor(), inviteId);
    expect(await db.select().from(ownerInvites).where(eq(ownerInvites.id, inviteId))).toHaveLength(0);
  });

  it("la revoca chiude le sessioni; un nuovo invito ridà l'accesso", async () => {
    const email = `revoca-${unique()}@test.example`;
    const first = await activateInvite({ code: await inviteCode(await createInvite(actor(), ownerId, "Revoca")), taxId: FISCAL, email, password: "password-revoca" });
    if (!first.ok) throw new Error(first.message);
    await db.insert(sessions).values({ id: `s-${unique()}`, userId: first.userId, marinaId, ownerAccessId: first.accessId, expiresAt: new Date(Date.now() + 60_000) });

    await expect(revokeAccess({ marinaId: otherMarinaId, user: { id: staffId } }, first.accessId)).rejects.toThrow(/non trovato/);
    await revokeAccess(actor(), first.accessId);
    expect(await db.select().from(sessions).where(eq(sessions.ownerAccessId, first.accessId))).toHaveLength(0);
    expect((await db.select().from(ownerAccess).where(eq(ownerAccess.id, first.accessId)))[0].revokedAt).not.toBeNull();

    const again = await activateInvite({ code: await inviteCode(await createInvite(actor(), ownerId, "Revoca")), taxId: FISCAL, email, password: "password-revoca" });
    expect(again).toMatchObject({ ok: true, accessId: first.accessId });
    expect((await db.select().from(ownerAccess).where(eq(ownerAccess.id, first.accessId)))[0].revokedAt).toBeNull();
  });
});
