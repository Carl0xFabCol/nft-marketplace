// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 rehearsal guards. Everything the rehearsal touches must be LOCAL:
// a loopback Anvil, a loopback Supabase stack, Anvil's published test keys.
// These checks run before any production entry point is imported, and they
// fail closed: an unexpected value is an error, never a warning.
// ─────────────────────────────────────────────────────────────────────────────

import path from "node:path"
import type { Hex } from "viem"

/** The throwaway chain id. It never appears in production config (guard test). */
export const REHEARSAL_CHAIN_ID = 31337
/** The DeploymentConfig.sol network name for a local Anvil (block.chainid). */
export const REHEARSAL_NETWORK = "anvil"

/**
 * Anvil's default accounts (mnemonic "test test test test test test test test
 * test test test junk", m/44'/60'/0'/0/i). Published, worthless test keys:
 * the only keys the rehearsal ever signs with. `guards.test.ts` re-derives each
 * address from its key.
 */
export const ANVIL_ACCOUNTS: readonly { readonly address: Hex; readonly privateKey: Hex }[] = [
  { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
  { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
  { address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" },
  { address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", privateKey: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" },
  { address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", privateKey: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" },
  { address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", privateKey: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" },
  { address: "0x976EA74026E726554dB657fA54763abd0C3a0aa9", privateKey: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" },
  { address: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955", privateKey: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" },
]

export class RehearsalGuardError extends Error {
  constructor(message: string) {
    super(`REHEARSAL GUARD: ${message}`)
    this.name = "RehearsalGuardError"
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

/** True only for an http(s)/ws(s) URL whose host is loopback. */
export function isLoopbackUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (!["http:", "https:", "ws:", "wss:", "postgres:", "postgresql:"].includes(url.protocol)) return false
  return LOOPBACK_HOSTS.has(url.hostname)
}

export function requireLoopbackUrl(name: string, value: string | undefined): string {
  if (!value) throw new RehearsalGuardError(`${name} is required`)
  if (!isLoopbackUrl(value)) throw new RehearsalGuardError(`${name} must be a loopback URL (127.0.0.1/localhost/::1), got ${redact(value)}`)
  return value
}

/** Never print credentials embedded in a URL. */
export function redact(value: string): string {
  try {
    const url = new URL(value)
    if (url.password) url.password = "***"
    if (url.username) url.username = "***"
    url.search = url.search ? "?***" : ""
    return url.toString()
  } catch {
    return value.length > 12 ? `${value.slice(0, 12)}…` : value
  }
}

/** Every URL-looking token inside a string (argv value, `name=url` pair). */
export function urlsIn(value: string): string[] {
  return value.match(/[a-z][a-z0-9+.-]*:\/\/[^\s,;"']+/gi) ?? []
}

/** Env vars that carry RPC or database endpoints in the indexer / web. */
export const URL_ENV_KEYS = ["FAST_RPC_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "REHEARSAL_RPC_URL"] as const
/** Endpoints that must be explicitly EMPTY in a rehearsal (no remote fallback, no public IPFS gateway override). */
export const MUST_BE_EMPTY_ENV_KEYS = ["ARCHIVE_RPC_URL", "FALLBACK_RPC_URL", "IPFS_GATEWAY", "CONDUIT_API_KEY", "FAST_RPC_TOKEN"] as const

export interface LaunchGuardInput {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly argv: readonly string[]
  /** Repository root, used to refuse writes into packages/contracts/src. */
  readonly repoRoot: string
  readonly cwd: string
}

/**
 * Refuses unless this process is unmistakably a local rehearsal:
 * REHEARSAL=1, CHAIN_ID=31337, an explicit empty DOTENV_CONFIG_PATH file,
 * every URL in env and argv loopback, the remote-capable endpoints empty, and
 * no --out inside packages/contracts/src (the committed address map).
 */
export function assertRehearsalLaunch(input: LaunchGuardInput): void {
  const { env, argv } = input
  if (env.REHEARSAL !== "1") throw new RehearsalGuardError("REHEARSAL=1 is required")
  if (env.CHAIN_ID !== String(REHEARSAL_CHAIN_ID)) throw new RehearsalGuardError(`CHAIN_ID must be ${REHEARSAL_CHAIN_ID}, got ${JSON.stringify(env.CHAIN_ID)}`)
  if (!env.DOTENV_CONFIG_PATH) throw new RehearsalGuardError("DOTENV_CONFIG_PATH must point at an empty file so dotenv never reads a .env")
  if (path.basename(env.DOTENV_CONFIG_PATH).startsWith(".env")) {
    throw new RehearsalGuardError("DOTENV_CONFIG_PATH must not be a .env file")
  }

  for (const key of URL_ENV_KEYS) {
    const value = env[key]
    if (value !== undefined && value !== "") requireLoopbackUrl(key, value)
  }
  for (const key of MUST_BE_EMPTY_ENV_KEYS) {
    if (env[key]) throw new RehearsalGuardError(`${key} must be empty in a rehearsal`)
  }

  for (const arg of argv) {
    for (const url of urlsIn(arg)) requireLoopbackUrl("argv URL", url)
  }

  const protectedDir = path.resolve(input.repoRoot, "packages", "contracts", "src") + path.sep
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--out") continue
    const out = argv[i + 1]
    if (!out) throw new RehearsalGuardError("--out requires a value")
    const resolved = path.resolve(input.cwd, out)
    if ((resolved + path.sep).toLowerCase().startsWith(protectedDir.toLowerCase())) {
      throw new RehearsalGuardError(`--out ${resolved} is inside packages/contracts/src; rehearsal output must stay in scratch`)
    }
  }
}

/** Absolute repo root from this file's location (scripts/rehearsal/src). */
export function repoRootFrom(dirname: string): string {
  return path.resolve(dirname, "..", "..", "..")
}
