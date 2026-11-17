// Messaggi ai diportisti: permessi, destinatari, lettura e notifiche (verso un finto servizio push locale).
// Usano il database di test: senza, vengono saltati.
import { execFileSync } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { db } from "@/db";
import { berthCategories, berths, boats, contracts, messageRecipients, ownerAccess, owners, piers, pushSubscriptions, users } from "@/db/schema";
import { createMarinaWithDefaults } from "@/server/marina-setup";
import { canSendTo, markRead, ownerMessages, resolveAudience, sendMessage, unreadCount } from "@/server/messages";
import { generateVAPIDKeys } from "web-push";

describe("permessi", () => {
  it("la banchina non scrive a tutti", () => {
    expect(canSendTo("banchina", "tutti")).toBe(false);
    expect(canSendTo("banchina", "tipo")).toBe(false);
    expect(canSendTo("banchina", "pontile")).toBe(true);
    expect(canSendTo("banchina", "cliente")).toBe(true);
    expect(canSendTo("ufficio", "tutti")).toBe(true);
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

describe.skipIf(!hasDb)("destinatari, lettura e notifiche", () => {
  let marinaId: string;
  let staffId: string;
  let pierA: string;
  let pierB: string;
  let ownerA: string; // contratto attivo sul pontile A, in porto, con app e notifiche
  let ownerB: string; // contratto attivo sul pontile B, stagionale
  let ownerOld: string; // nessun contratto attivo
  let boaterId: string;
  let server: Server;
  let received: { path: string; headers: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "drizzle" });
    const [staff] = await db.insert(users).values({ email: `staff-${unique()}@test.example`, name: "Ufficio", passwordHash: "x" }).returning({ id: users.id });
    staffId = staff.id;
    marinaId = await db.transaction((tx) => createMarinaWithDefaults(tx, { name: `Porto ${unique()}`, userId: staffId, year: 2026 }));
    const [cat] = await db.select().from(berthCategories).where(eq(berthCategories.marinaId, marinaId)).limit(1);
    [{ id: pierA }] = await db.insert(piers).values({ marinaId, code: "A", name: "Pontile A" }).returning({ id: piers.id });
    [{ id: pierB }] = await db.insert(piers).values({ marinaId, code: "B", name: "Pontile B" }).returning({ id: piers.id });
    const berth = async (pierId: string, code: string) =>
      (await db.insert(berths).values({ marinaId, pierId, categoryId: cat.id, code, lengthCm: 1000, beamCm: 400 }).returning({ id: berths.id }))[0].id;
    const owner = async (name: string) => (await db.insert(owners).values({ marinaId, displayName: name }).returning({ id: owners.id }))[0].id;
    const boat = async (ownerId: string) =>
      (await db.insert(boats).values({ marinaId, ownerId, name: "Barca", lengthCm: 800, beamCm: 300 }).returning({ id: boats.id }))[0].id;
    ownerA = await owner("Cliente A");
    ownerB = await owner("Cliente B");
    ownerOld = await owner("Ex cliente");
    const contract = (ownerId: string, berthId: string, type: "annuale" | "stagionale", status: "attivo" | "concluso", presence: "in_porto" | "fuori") =>
      boat(ownerId).then((boatId) =>
        db.insert(contracts).values({ marinaId, ownerId, boatId, berthId, type, status, presence, year: 2026, startDate: "2026-01-01", endDate: "2026-12-31", occupiedUntil: "2026-12-31", amountCents: 100000, vatRate: 22 }),
      );
    await contract(ownerA, await berth(pierA, "A01"), "annuale", "attivo", "in_porto");
    await contract(ownerB, await berth(pierB, "B01"), "stagionale", "attivo", "fuori");
    await contract(ownerOld, await berth(pierA, "A02"), "annuale", "concluso", "fuori");

    const [boater] = await db.insert(users).values({ email: `diportista-${unique()}@test.example`, name: "Diportista", passwordHash: "x" }).returning({ id: users.id });
    boaterId = boater.id;
    await db.insert(ownerAccess).values({ marinaId, ownerId: ownerA, userId: boaterId });

    // Finto servizio push (HTTPS con un certificato fatto al momento): risponde 201, oppure 410 per l'indirizzo «scaduto».
    const dir = mkdtempSync(join(tmpdir(), "push-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=127.0.0.1", "-days", "1", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")], {
      stdio: "ignore",
    });
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    server = createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
      received.push({ path: req.url ?? "", headers: req.headers });
      req.resume();
      req.on("end", () => {
        res.statusCode = req.url?.includes("scaduto") ? 410 : 201;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const keys = generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "mailto:test@test.example";
    const device = () => ({
      p256dh: createECDH("prime256v1").generateKeys().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    });
    await db.insert(pushSubscriptions).values([
      { userId: boaterId, endpoint: `https://127.0.0.1:${port}/push/attivo-${unique()}`, ...device() },
      { userId: boaterId, endpoint: `https://127.0.0.1:${port}/push/scaduto-${unique()}`, ...device() },
    ]);
  });

  afterAll(async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    if (server) await new Promise((r) => server.close(r));
  });

  it("risolve i gruppi solo sui contratti attivi", async () => {
    expect((await resolveAudience(marinaId, { type: "tutti" })).ownerIds.sort()).toEqual([ownerA, ownerB].sort());
    expect(await resolveAudience(marinaId, { type: "pontile", pierId: pierA })).toEqual({ ownerIds: [ownerA], label: "Pontile A" });
    expect((await resolveAudience(marinaId, { type: "tipo", contractType: "stagionale" })).ownerIds).toEqual([ownerB]);
    expect((await resolveAudience(marinaId, { type: "in_porto" })).ownerIds).toEqual([ownerA]);
    expect((await resolveAudience(marinaId, { type: "cliente", ownerId: ownerOld })).ownerIds).toEqual([ownerOld]);
  });

  it("invia, notifica i dispositivi, toglie quelli scaduti e segna la lettura", async () => {
    received = [];
    const sender = { marinaId, role: "ufficio" as const, user: { id: staffId } };
    const sent = await sendMessage(sender, { kind: "urgente", title: "Vento forte", body: "Controllate gli ormeggi.", audience: { type: "pontile", pierId: pierA } });
    expect(sent).toMatchObject({ recipients: 1, withApp: 1 });

    // Due dispositivi raggiunti, con l'intestazione VAPID; quello «scaduto» viene cancellato.
    expect(received).toHaveLength(2);
    expect(String(received[0].headers.authorization)).toMatch(/^vapid t=/);
    expect(received[0].headers.urgency).toBe("high");
    const left = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, boaterId));
    expect(left).toHaveLength(1);
    expect(left[0].endpoint).toContain("attivo");

    const scope = { marinaId, ownerId: ownerA };
    expect(await unreadCount(scope)).toEqual({ total: 1, urgent: 1 });
    expect(await ownerMessages({ marinaId, ownerId: ownerB })).toHaveLength(0);
    await markRead({ ...scope, userId: boaterId }, sent.messageId);
    expect(await unreadCount(scope)).toEqual({ total: 0, urgent: 0 });
    const [rec] = await db.select().from(messageRecipients).where(eq(messageRecipients.messageId, sent.messageId));
    expect(rec.readBy).toBe(boaterId);
  });

  it("rifiuta gruppi vuoti e gruppi non permessi al ruolo", async () => {
    await expect(sendMessage({ marinaId, role: "banchina", user: { id: staffId } }, { kind: "info", title: "x", body: "y", audience: { type: "tutti" } })).rejects.toThrow(
      /ruolo/,
    );
    await expect(
      sendMessage({ marinaId, role: "ufficio", user: { id: staffId } }, { kind: "info", title: "x", body: "y", audience: { type: "tipo", contractType: "transito" } }),
    ).rejects.toThrow(/Nessun cliente/);
  });
});
