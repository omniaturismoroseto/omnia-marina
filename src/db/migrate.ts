import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Numero qualsiasi, purché sempre lo stesso: identifica il "lucchetto" delle migrazioni nel database.
const MIGRATION_LOCK = 727_274;

/**
 * Applica le migrazioni SQL della cartella drizzle/ che il database non ha ancora.
 * Il lucchetto fa sì che, se partono più istanze insieme, una sola esegua le migrazioni e le altre aspettino.
 */
export async function runMigrations(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (!databaseUrl) throw new Error("DATABASE_URL non impostata");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
    await pool.end();
  }
}
