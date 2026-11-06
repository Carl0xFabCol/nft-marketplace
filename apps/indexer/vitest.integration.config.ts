import { defineConfig } from "vitest/config"

// Used by `pnpm validate:integration` (scripts/validate-integration.mjs).
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
  },
})
