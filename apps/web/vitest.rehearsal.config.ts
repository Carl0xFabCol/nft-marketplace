import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Phase 5 rehearsal suite: the web's data layer (services, the optimistic
// listing action) against the LOCAL rehearsal stack (Anvil chain 31337 + local
// Supabase). Run only by `pnpm --filter @marketplace/rehearsal anvil-e2e`,
// which passes REHEARSAL_* variables; every test is skipped without them and
// refuses non-loopback URLs. envDir points at an empty directory, so
// apps/web/.env is never loaded. Not part of the default `vitest run`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  envDir: fileURLToPath(new URL("./rehearsal/no-env", import.meta.url)),
  test: {
    include: ["rehearsal/**/*.rehearsal.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
})
