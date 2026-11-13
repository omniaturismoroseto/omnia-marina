// Applica le migrazioni al database indicato da DATABASE_URL. Uso: pnpm db:migrate
import { runMigrations } from "../src/db/migrate";

runMigrations()
  .then(() => console.log("Migrazioni applicate."))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
