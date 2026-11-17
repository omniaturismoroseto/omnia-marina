// Accessi con password locale e con Firebase Authentication. Usano il database di test e l'emulatore di
// Firebase Authentication (TEST_FIREBASE_AUTH_EMULATOR_HOST, predefinito 127.0.0.1:9099):
//   npx firebase-tools emulators:start --only auth --project demo-omnia
// Se uno dei due non è raggiungibile i test che ne hanno bisogno vengono saltati.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { db } from "@/db";
import { users } from "@/db/schema";
import { checkPassword, createAccount, loginFailure, requestPasswordReset, setPassword, verifyLogin } from "@/server/credentials";

const PROJECT = "demo-omnia";
const EMULATOR = process.env.TEST_FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

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

const hasDb = await databaseAvailable();
const hasEmulator = hasDb && (await emulatorAvailable());

function useFirebase(on: boolean) {
  if (on) {
    process.env.FIREBASE_PROJECT_ID = PROJECT;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = EMULATOR;
  } else {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  }
}

const email = (name: string) => `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.example`;

async function userRow(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

// Email inviate dall'emulatore (codici per la nuova password).
async function sentResetEmails(to: string): Promise<number> {
  const res = await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const { oobCodes } = (await res.json()) as { oobCodes: { email: string; requestType: string }[] };
  return oobCodes.filter((c) => c.email === to && c.requestType === "PASSWORD_RESET").length;
}

beforeAll(async () => {
  if (hasDb) await migrate(db, { migrationsFolder: "drizzle" });
});

afterAll(() => useFirebase(false));

describe("loginFailure", () => {
  it("traduce i codici di Firebase", () => {
    expect(loginFailure("INVALID_LOGIN_CREDENTIALS")).toBe("credentials");
    expect(loginFailure("EMAIL_NOT_FOUND")).toBe("credentials");
    expect(loginFailure("USER_DISABLED")).toBe("disabled");
    expect(loginFailure("TOO_MANY_ATTEMPTS_TRY_LATER")).toBe("throttled");
    expect(loginFailure("UNAVAILABLE")).toBe("unavailable");
  });
});

describe.skipIf(!hasDb)("password locale (Firebase spento)", () => {
  beforeAll(() => useFirebase(false));

  it("crea l'account e controlla la password", async () => {
    const mail = email("locale");
    const id = await createAccount(db, { email: mail, name: "Locale", password: "password-giusta" });
    expect((await userRow(id)).passwordHash).toMatch(/^scrypt\$/);
    expect(await verifyLogin(mail, "password-giusta")).toEqual({ ok: true, userId: id });
    expect(await verifyLogin(mail, "password-sbagliata")).toEqual({ ok: false, reason: "credentials" });
    await setPassword(id, "nuova-password-1");
    expect(await checkPassword(id, "nuova-password-1")).toBe(true);
    expect(await checkPassword(id, "password-giusta")).toBe(false);
  });
});

describe.skipIf(!hasEmulator)("Firebase Authentication (emulatore)", () => {
  it("sposta su Firebase l'account locale al primo accesso riuscito, con la stessa password", async () => {
    useFirebase(false);
    const mail = email("sposta");
    const id = await createAccount(db, { email: mail, name: "Da spostare", password: "password-di-oggi" });
    useFirebase(true);

    expect(await verifyLogin(mail, "sbagliata-123")).toEqual({ ok: false, reason: "credentials" });
    expect((await userRow(id)).firebaseUid).toBeNull();

    expect(await verifyLogin(mail, "password-di-oggi")).toEqual({ ok: true, userId: id });
    const moved = await userRow(id);
    expect(moved.firebaseUid).toBe(id);
    expect(moved.passwordHash).toBeNull();

    // Da qui decide Firebase.
    expect(await verifyLogin(mail, "password-di-oggi")).toEqual({ ok: true, userId: id });
    expect(await verifyLogin(mail, "sbagliata-123")).toEqual({ ok: false, reason: "credentials" });
  });

  it("crea i nuovi account su Firebase e ne cambia la password", async () => {
    useFirebase(true);
    const mail = email("nuovo");
    const id = await createAccount(db, { email: mail, name: "Nuovo", password: "provvisoria-1" });
    const row = await userRow(id);
    expect(row.firebaseUid).toBe(id);
    expect(row.passwordHash).toBeNull();
    expect(await verifyLogin(mail, "provvisoria-1")).toEqual({ ok: true, userId: id });

    await setPassword(id, "definitiva-22");
    expect(await checkPassword(id, "definitiva-22")).toBe(true);
    expect(await checkPassword(id, "provvisoria-1")).toBe(false);
    expect(await verifyLogin(mail, "definitiva-22")).toEqual({ ok: true, userId: id });
  });

  it("riprende un account Firebase rimasto senza utente dell'app", async () => {
    useFirebase(true);
    const mail = email("orfano");
    // Simula un salvataggio interrotto: l'account Firebase esiste, l'utente dell'app no.
    const orphanId = await db.transaction(async (tx) => {
      const id = await createAccount(tx, { email: mail, name: "Orfano", password: "prima-password" });
      tx.rollback();
      return id;
    }).catch(() => null);
    expect(orphanId).toBeNull();
    expect(await verifyLogin(mail, "prima-password")).toEqual({ ok: false, reason: "credentials" });

    const id = await createAccount(db, { email: mail, name: "Orfano", password: "seconda-password" });
    expect(await verifyLogin(mail, "seconda-password")).toEqual({ ok: true, userId: id });
  });

  it("password dimenticata: invia l'email, anche a chi aveva ancora la password locale", async () => {
    useFirebase(false);
    const mail = email("dimenticata");
    const id = await createAccount(db, { email: mail, name: "Smemorato", password: "password-vecchia" });
    useFirebase(true);

    await requestPasswordReset(mail);
    expect(await sentResetEmails(mail)).toBe(1);
    // L'account è passato su Firebase e la vecchia password non vale più.
    expect((await userRow(id)).firebaseUid).toBe(id);
    expect(await verifyLogin(mail, "password-vecchia")).toEqual({ ok: false, reason: "credentials" });

    // Un'email sconosciuta non dà errori e non invia niente.
    const unknown = email("sconosciuto");
    await requestPasswordReset(unknown);
    expect(await sentResetEmails(unknown)).toBe(0);
  });
});
