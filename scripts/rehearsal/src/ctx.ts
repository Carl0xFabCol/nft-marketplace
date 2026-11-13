// Shared rehearsal context and the launcher for production entry points
// (always through launch.ts, which enforces the guards).

import { createRequire } from "node:module"
import path from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Addresses, Chain, Collections } from "./chain"
import { RPC_URL } from "./chain"
import type { DbPaths, StackEnv } from "./db"
import { REHEARSAL_CHAIN_ID } from "./guards"
import type { RunLog } from "./log"
import { run, spawnBackground, type Background, type RunOptions, type RunResult } from "./proc"

export interface Ctx {
  repoRoot: string
  scratch: string
  log: RunLog
  dbPaths: DbPaths
  stack: StackEnv
  admin: SupabaseClient
  chain: Chain
  foundryDir: string
  addresses: Addresses
  collections: Collections
  deployBlock: bigint
  addressesFile: string
  deploymentsDir: string
}

const requireHere = createRequire(__filename)
/** tsx's CLI entry, run with the current node binary (no shell, no .cmd shim). */
export function tsxCli(): string {
  return requireHere.resolve("tsx/cli")
}
export const REHEARSAL_PKG = path.resolve(__dirname, "..")

/** Environment for any production entry point started through launch.ts. */
export function rehearsalEnv(c: Pick<Ctx, "scratch" | "stack" | "addressesFile">, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    REHEARSAL: "1",
    CHAIN_ID: String(REHEARSAL_CHAIN_ID),
    DOTENV_CONFIG_PATH: path.join(c.scratch, "empty-dotenv"),
    REHEARSAL_ADDRESSES_FILE: c.addressesFile,
    FAST_RPC_URL: RPC_URL,
    ARCHIVE_RPC_URL: "",
    FALLBACK_RPC_URL: "",
    IPFS_GATEWAY: "",
    SUPABASE_URL: c.stack.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: c.stack.serviceRoleKey,
    LOG_LEVEL: "info",
    NODE_ENV: "development",
    ...extra,
  }
}

export function launch(c: Pick<Ctx, "scratch" | "stack" | "addressesFile">, target: string, args: string[], opts: RunOptions & { extraEnv?: Record<string, string | undefined> } = {}): Promise<RunResult> {
  return run(process.execPath, [tsxCli(), "src/launch.ts", target, ...args], {
    cwd: REHEARSAL_PKG,
    timeoutMs: opts.timeoutMs ?? 300_000,
    allowFail: opts.allowFail,
    env: rehearsalEnv(c, opts.extraEnv),
  })
}

export function launchBackground(c: Pick<Ctx, "scratch" | "stack" | "addressesFile">, target: string, args: string[], logPath: string, extraEnv: Record<string, string | undefined> = {}): Background {
  return spawnBackground(process.execPath, [tsxCli(), "src/launch.ts", target, ...args], { cwd: REHEARSAL_PKG, env: rehearsalEnv(c, extraEnv), logPath })
}
