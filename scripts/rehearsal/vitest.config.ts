import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Offline unit tests only (guards, reconciliation diff logic, the production
// config guard). Nothing here starts Anvil or touches a database; that is
// `pnpm --filter @marketplace/rehearsal anvil-e2e`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../apps/web", import.meta.url)) },
  },
  // Never load a .env file from this or any other directory.
  envDir: fileURLToPath(new URL("./src/__tests__/no-env", import.meta.url)),
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
