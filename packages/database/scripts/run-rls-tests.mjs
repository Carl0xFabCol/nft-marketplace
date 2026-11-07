import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dbUrl = process.env.SEC01_TEST_DB_URL

if (!dbUrl) {
  console.error("SEC01_TEST_DB_URL is required (point it at a disposable test/staging Supabase database).")
  process.exit(1)
}

// Use the package-local Supabase CLI (devDependency) through npx; no global install is assumed.
// Extra arguments are passed through to the CLI, e.g.
//   pnpm test:rls -- --workdir <dir containing the local stack's supabase/ project>
// so pg_prove joins the right Docker network (the CLI derives it from the project id).
// pnpm forwards a literal "--" separator; drop it so the CLI still parses the flags.
const extraArgs = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"))
// Absolute path, so --workdir does not change where the tests are resolved from.
const testsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "tests")
const isWindows = process.platform === "win32"
const result = spawnSync(isWindows ? "npx.cmd" : "npx", ["supabase", "test", "db", testsDir, "--db-url", dbUrl, ...extraArgs], {
  stdio: "inherit",
  shell: isWindows,
})

process.exit(result.status ?? 1)
