// Avvia il server di produzione compilato con `pnpm build`. Uso: pnpm start
// Next produce un server autonomo in .next/standalone: qui gli si affiancano i file statici e le migrazioni.
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const standalone = resolve(".next/standalone");
if (!existsSync(resolve(standalone, "server.js"))) {
  console.error("Compilazione non trovata: esegui prima `pnpm build`.");
  process.exit(1);
}
cpSync("public", resolve(standalone, "public"), { recursive: true });
cpSync(".next/static", resolve(standalone, ".next/static"), { recursive: true });
cpSync("drizzle", resolve(standalone, "drizzle"), { recursive: true });

process.env.PORT ??= "3000";
await import(pathToFileURL(resolve(standalone, "server.js")).href);
