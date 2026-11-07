import { spawnSync } from "node:child_process"

const dbUrl = process.env.SEC01_TEST_DB_URL

if (!dbUrl) {
  console.error("SEC01_TEST_DB_URL is required (point it at a disposable test/staging Supabase database).")
  process.exit(1)
}

// Use the package-local Supabase CLI (devDependency) through npx; no global install is assumed.
const isWindows = process.platform === "win32"
const result = spawnSync(isWindows ? "npx.cmd" : "npx", ["supabase", "test", "db", "tests", "--db-url", dbUrl], {
  stdio: "inherit",
  shell: isWindows,
})

process.exit(result.status ?? 1)
