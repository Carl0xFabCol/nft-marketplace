import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    // lib/supabase/rls.integration.test.ts is included on purpose: it is
    // describe.skipIf(!SEC01_TEST_SUPABASE_*) and reports 22 skipped tests until
    // it is pointed at a disposable local Supabase stack (never a live project).
    // rehearsal/: Phase 5 suite, run only via vitest.rehearsal.config.ts.
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/.turbo/**", "rehearsal/**"],
    environment: "node",
  },
})
