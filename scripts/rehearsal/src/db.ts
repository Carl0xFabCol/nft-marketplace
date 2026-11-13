// Local Supabase stack for the rehearsal (scratch workdir outside the repo,
// project_id sec01-local, only db/auth/rest/kong). Schema = the byte-preserving
// adapted baseline + every migration (090000-091600), proven equal to the
// committed catalog fingerprint before anything else runs. Keys come from
// `supabase status -o env` in process memory and are never written to disk.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { requireLoopbackUrl } from "./guards"
import { run, type RunResult } from "./proc"

export const PROJECT_ID = "sec01-local"
export const DB_CONTAINER = `supabase_db_${PROJECT_ID}`
/** Everything except db (implicit), gotrue (auth), kong and postgrest (rest). */
const EXCLUDED = ["realtime", "storage-api", "imgproxy", "mailpit", "postgres-meta", "studio", "edge-runtime", "logflare", "vector", "supavisor"]

export interface StackEnv {
  apiUrl: string
  dbUrl: string
  serviceRoleKey: string
  anonKey: string
}

export interface DbPaths {
  repoRoot: string
  /** Scratch dir holding supabase/config.toml (outside the repo). */
  workdir: string
}

function supabaseCli(repoRoot: string): string {
  const js = path.join(repoRoot, "packages", "database", "node_modules", "supabase", "dist", "supabase.js")
  if (!existsSync(js)) throw new Error(`supabase CLI not found at ${js}; run pnpm install`)
  return js
}

export function supabase(p: DbPaths, args: string[], opts: { allowFail?: boolean; timeoutMs?: number } = {}): Promise<RunResult> {
  return run(process.execPath, [supabaseCli(p.repoRoot), ...args, "--workdir", p.workdir], {
    cwd: path.join(p.repoRoot, "packages", "database"),
    timeoutMs: opts.timeoutMs ?? 600_000,
    allowFail: opts.allowFail,
  })
}

/** psql inside the db container (no host psql needed). Returns stdout. */
export async function psql(sql: string | Buffer, opts: { as?: "postgres" | "supabase_admin"; tuplesOnly?: boolean; allowFail?: boolean } = {}): Promise<string> {
  const args = ["exec", "-i", DB_CONTAINER, "psql", "-U", opts.as ?? "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"]
  if (opts.tuplesOnly) args.push("-At")
  const r = await run("docker", args, { input: sql, timeoutMs: 120_000, allowFail: opts.allowFail })
  if (r.code !== 0) return `ERROR(${r.code}): ${r.stderr}`
  return r.stdout
}

/** One-row/one-column query, as exact text. */
export async function scalar(sql: string): Promise<string> {
  return (await psql(sql, { tuplesOnly: true })).replace(/\r?\n$/, "")
}

export function parseEnvOutput(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="?(.*?)"?$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

/**
 * The adapted baseline, byte for byte: only `CREATE SCHEMA public;` is dropped
 * and the 12 `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` lines move to a
 * second script run as supabase_admin (SEC01_STATUS §3.1). Line endings (the
 * dump mixes CRLF and LF, and live function bodies are CRLF) are untouched.
 */
export function adaptBaseline(raw: Buffer): { main: Buffer; asSupabaseAdmin: Buffer; dropped: number } {
  const text = raw.toString("latin1")
  const lines = text.split(/(?<=\n)/)
  const main: string[] = []
  const admin: string[] = []
  let dropped = 0
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, "")
    if (bare === "CREATE SCHEMA public;") {
      dropped++
      continue
    }
    if (bare.startsWith("ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ")) {
      admin.push(line)
      continue
    }
    main.push(line)
  }
  if (dropped !== 1 || admin.length !== 12) {
    throw new Error(`unexpected baseline shape: dropped ${dropped} CREATE SCHEMA line(s), found ${admin.length} supabase_admin default-ACL line(s) (expected 1 and 12)`)
  }
  return { main: Buffer.from(main.join(""), "latin1"), asSupabaseAdmin: Buffer.from(admin.join(""), "latin1"), dropped }
}

export interface SetupResult {
  env: StackEnv
  migrations: string[]
  fingerprint: "FINGERPRINT-SAME"
}

/** Fresh stack → adapted baseline → all migrations → fingerprint == after_phase3b.txt. */
export async function setupLocalDb(p: DbPaths, log: (m: string) => void): Promise<SetupResult> {
  mkdirSync(p.workdir, { recursive: true })
  const config = path.join(p.workdir, "supabase", "config.toml")
  if (!existsSync(config)) {
    await supabase(p, ["init", "--force"])
  }
  const toml = readFileSync(config, "utf8")
  writeFileSync(config, toml.replace(/^project_id\s*=.*$/m, `project_id = "${PROJECT_ID}"`))

  // A fresh, empty database every run: no volume is reused.
  await supabase(p, ["stop", "--no-backup"], { allowFail: true })
  log("starting local supabase (db, auth, rest, kong)")
  await supabase(p, ["start", "-x", EXCLUDED.join(",")], { timeoutMs: 900_000 })
  const env = await stackEnv(p)

  const baselinePath = path.join(p.repoRoot, "packages", "database", "baseline", "baseline_schema.sql")
  if (!existsSync(baselinePath)) throw new Error(`baseline not found at ${baselinePath} (gitignored; restore it locally)`)
  const adapted = adaptBaseline(readFileSync(baselinePath))
  await mustPsql(adapted.main, "postgres", "baseline")
  await mustPsql(adapted.asSupabaseAdmin, "supabase_admin", "baseline default ACLs")

  const migDir = path.join(p.repoRoot, "packages", "database", "migrations")
  const migrations = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()
  for (const m of migrations) {
    await mustPsql(readFileSync(path.join(migDir, m)), "postgres", m)
  }
  log(`applied ${migrations.length} migrations (${migrations[0]} … ${migrations.at(-1)})`)

  const fpSql = readFileSync(path.join(p.repoRoot, "packages", "database", "scripts", "rehearsal", "catalog_fingerprint.sql"))
  const fp = await run("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-F", " | ", "-v", "ON_ERROR_STOP=1"], { input: fpSql })
  const expected = readFileSync(path.join(p.repoRoot, "packages", "database", "scripts", "rehearsal", "catalog_fingerprint.after_phase3b.txt"), "utf8").replace(/\r\n/g, "\n")
  if (fp.stdout.replace(/\r\n/g, "\n") !== expected) {
    writeFileSync(path.join(p.workdir, "fingerprint.actual.txt"), fp.stdout)
    throw new Error(`catalog fingerprint differs from catalog_fingerprint.after_phase3b.txt (actual written to ${p.workdir}/fingerprint.actual.txt)`)
  }
  await psql("notify pgrst, 'reload schema';")
  return { env, migrations, fingerprint: "FINGERPRINT-SAME" }
}

async function mustPsql(sql: Buffer, as: "postgres" | "supabase_admin", label: string): Promise<void> {
  const r = await run("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", as, "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"], { input: sql, allowFail: true, timeoutMs: 120_000 })
  if (r.code !== 0) throw new Error(`${label} failed (exit ${r.code}): ${r.stderr.split(/\r?\n/).filter(Boolean).slice(-5).join(" | ")}`)
}

export async function stackEnv(p: DbPaths): Promise<StackEnv> {
  const status = parseEnvOutput((await supabase(p, ["status", "-o", "env"])).stdout)
  const env = {
    apiUrl: requireLoopbackUrl("API_URL", status.API_URL),
    dbUrl: requireLoopbackUrl("DB_URL", status.DB_URL),
    serviceRoleKey: status.SERVICE_ROLE_KEY ?? "",
    anonKey: status.ANON_KEY ?? "",
  }
  if (!env.serviceRoleKey || !env.anonKey) throw new Error("supabase status did not report the local keys")
  return env
}

export async function stopLocalDb(p: DbPaths): Promise<void> {
  await supabase(p, ["stop", "--no-backup"], { allowFail: true })
}

export function adminClient(env: StackEnv): SupabaseClient {
  requireLoopbackUrl("API_URL", env.apiUrl)
  return createClient(env.apiUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
}
