import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // I test di dominio usano un database separato, mai quello di lavoro.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://omnia_marina:omnia_marina@localhost:5432/omnia_marina_test",
    },
    fileParallelism: false,
  },
});
