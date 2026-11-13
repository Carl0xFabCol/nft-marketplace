// ─────────────────────────────────────────────────────────────────────────────
// launch.ts — run an UNMODIFIED production entry point against the rehearsal
// chain (31337), without adding 31337 to any production config file.
//
//   REHEARSAL=1 CHAIN_ID=31337 DOTENV_CONFIG_PATH=<scratch>/empty.env \
//   [REHEARSAL_ADDRESSES_FILE=<scratch>/addresses.generated.ts] \
//   tsx src/launch.ts <generate-addresses|prepare-deployment|indexer> [args…]
//
// Order of operations:
//   1. assertRehearsalLaunch: REHEARSAL=1, CHAIN_ID=31337, DOTENV_CONFIG_PATH
//      set (so dotenv never reads a .env), every URL loopback, remote-capable
//      endpoints empty, no --out into packages/contracts/src. Fails closed.
//   2. Register the rehearsal chain IN THIS PROCESS'S MEMORY ONLY:
//        SUPPORTED_CHAIN_IDS (shared)        += 31337
//        NETWORK_CHAIN_IDS (address rules)   .anvil = 31337
//        VIEM_CHAINS_BY_ID (indexer)         [31337] = viem `foundry`
//        CONTRACT_ADDRESSES (contracts)      [31337] = the generator's OWN
//          output file (REHEARSAL_ADDRESSES_FILE), so the indexer consumes
//          exactly what generate-addresses produced.
//   3. import() the real entry point, which runs its own main().
//
// If any patch failed to reach the entry point's module instance, the entry
// point rejects CHAIN_ID=31337 itself ("CHAIN_ID must be one of …" /
// "Unsupported chain id" / "No contract addresses configured"): loud, never
// silent. Nothing here is imported by production code.
// ─────────────────────────────────────────────────────────────────────────────

import path from "node:path"
import { pathToFileURL } from "node:url"
import { foundry } from "viem/chains"
import { SUPPORTED_CHAIN_IDS } from "@marketplace/shared"
import { CONTRACT_ADDRESSES, type ContractAddresses } from "@marketplace/contracts"
import { NETWORK_CHAIN_IDS } from "@marketplace/contracts/deployment-records"
import { VIEM_CHAINS_BY_ID } from "../../../apps/indexer/src/providers/chains"
import { assertRehearsalLaunch, REHEARSAL_CHAIN_ID, REHEARSAL_NETWORK, RehearsalGuardError, repoRootFrom } from "./guards"

const REPO_ROOT = repoRootFrom(__dirname)

export const LAUNCH_TARGETS = {
  "generate-addresses": path.join(REPO_ROOT, "packages", "contracts", "scripts", "generate-addresses.ts"),
  "prepare-deployment": path.join(REPO_ROOT, "apps", "indexer", "src", "scripts", "prepare-deployment.ts"),
  indexer: path.join(REPO_ROOT, "apps", "indexer", "src", "index.ts"),
} as const
export type LaunchTarget = keyof typeof LAUNCH_TARGETS

/** Registers 31337 in the in-memory registries (see header). Idempotent. */
export function installRehearsalChain(addresses?: ContractAddresses): void {
  const supported = SUPPORTED_CHAIN_IDS as number[]
  if (!supported.includes(REHEARSAL_CHAIN_ID)) supported.push(REHEARSAL_CHAIN_ID)
  ;(NETWORK_CHAIN_IDS as Record<string, number>)[REHEARSAL_NETWORK] = REHEARSAL_CHAIN_ID
  VIEM_CHAINS_BY_ID[REHEARSAL_CHAIN_ID] = foundry
  if (addresses) CONTRACT_ADDRESSES[REHEARSAL_CHAIN_ID] = addresses
}

async function loadGeneratedAddresses(file: string): Promise<ContractAddresses> {
  const protectedDir = path.join(REPO_ROOT, "packages", "contracts", "src").toLowerCase()
  if (path.resolve(file).toLowerCase().startsWith(protectedDir)) {
    throw new RehearsalGuardError("REHEARSAL_ADDRESSES_FILE must be the scratch output, not packages/contracts/src")
  }
  const mod = (await import(pathToFileURL(path.resolve(file)).href)) as {
    GENERATED_CONTRACT_ADDRESSES?: Record<number, ContractAddresses>
    default?: { GENERATED_CONTRACT_ADDRESSES?: Record<number, ContractAddresses> }
  }
  const map = mod.GENERATED_CONTRACT_ADDRESSES ?? mod.default?.GENERATED_CONTRACT_ADDRESSES
  const entry = map?.[REHEARSAL_CHAIN_ID]
  if (!entry) throw new RehearsalGuardError(`${file} has no GENERATED_CONTRACT_ADDRESSES[${REHEARSAL_CHAIN_ID}]`)
  return entry
}

async function main(): Promise<void> {
  const [target, ...args] = process.argv.slice(2)
  if (!target || !(target in LAUNCH_TARGETS)) {
    throw new RehearsalGuardError(`target must be one of ${Object.keys(LAUNCH_TARGETS).join(", ")}, got ${JSON.stringify(target)}`)
  }
  assertRehearsalLaunch({ env: process.env, argv: args, repoRoot: REPO_ROOT, cwd: process.cwd() })

  let addresses: ContractAddresses | undefined
  if (target !== "generate-addresses") {
    const file = process.env.REHEARSAL_ADDRESSES_FILE
    if (!file) throw new RehearsalGuardError(`${target} needs REHEARSAL_ADDRESSES_FILE (the generate-addresses output)`)
    addresses = await loadGeneratedAddresses(file)
  }
  installRehearsalChain(addresses)

  const entry = LAUNCH_TARGETS[target as LaunchTarget]
  process.argv = [process.argv[0], entry, ...args]
  await import(pathToFileURL(entry).href)
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
