import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // *.integration.test.ts encode known defects and run only in the
    // continue-on-error CI job (see docs/PRODUCTION_PLAN.md).
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
    environment: "node",
  },
})
