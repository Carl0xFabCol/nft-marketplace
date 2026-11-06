import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // *.integration.test.ts encode known defects and run only via
    // `pnpm validate:integration` (continue-on-error CI job).
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
    environment: "node",
  },
})
