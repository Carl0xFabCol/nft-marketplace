// ─────────────────────────────────────────────────────────────────────────────
// validate:integration: checks (a), (b), (c), (d), (f) of INTEGRATION_AUDIT §8
// step 6, including test #7 (config coverage, §10).
//
// KNOWN-FAILING by design (Phase 0). These checks encode defects the audit
// found; they are NOT fixed here and must not be weakened. They run in the
// continue-on-error CI job `integration-contract-tests` and are excluded from
// the default `vitest run`. See "Known-failing tests" in docs/PRODUCTION_PLAN.md.
//
// Run: pnpm validate:integration [--chain-id 99801] [--live]
//
// No .env is ever read: dotenv/config is mocked, and the real env loader is
// only exercised with stubbed variables. (d) is the only live check and runs
// only with --live (VALIDATE_LIVE=1); it is off in CI.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("dotenv/config", () => ({}))
vi.mock("../config/env", () => ({
  env: { chainId: Number(process.env.CHAIN_ID ?? 99801) },
}))

import { createPublicClient, erc721Abi, http, type Abi } from "viem"
import {
  MarketplaceBidsEventsAbi,
  MarketplaceCoreEventsAbi,
  Erc721TransferEventAbi,
} from "@marketplace/contracts/abis/generated/events"
import {
  checkChainId,
  checkDefaultChainIdConsistent,
  checkEventsExist,
  checkHandlerBijection,
  checkRpcChainId,
  type IndexedContract,
  type UnsetChainIdOutcome,
} from "@marketplace/contracts/integration-checks"
import { DEFAULT_ADDRESSES_CHAIN_ID } from "@marketplace/contracts"
import { DEFAULT_CHAIN_ID, SUPPORTED_CHAIN_IDS } from "@marketplace/shared"
import { CONTRACTS_TO_INDEX } from "../config/contracts.config"
import { createBidsEventHandlers } from "../handlers/BidsEventHandler"
import { createCoreEventHandlers } from "../handlers/CoreEventHandler"
import { createTransferHandler } from "../handlers/TransferHandler"

const EVENTS_ABI_BY_CONTRACT: Record<string, Abi> = {
  core: MarketplaceCoreEventsAbi,
  bids: MarketplaceBidsEventsAbi,
  nft: Erc721TransferEventAbi,
}

/**
 * Everything the indexer subscribes to: the static CONTRACTS_TO_INDEX plus the
 * per-collection ERC-721 subscription that IndexerOrchestrator builds at
 * runtime (src/services/IndexerOrchestrator.ts: name "nft", events ["Transfer"]).
 */
function indexedContracts(): IndexedContract[] {
  return [...CONTRACTS_TO_INDEX.map((c) => ({ name: c.name, events: c.events })), { name: "nft", events: ["Transfer"] }]
}

/** The real handler set, exactly as src/index.ts registers it. Repos are never called. */
function registeredHandlers() {
  const stub = {} as never
  return [
    ...createCoreEventHandlers(stub, stub, stub, stub, stub),
    ...createBidsEventHandlers(stub, stub, stub, stub, stub, stub),
    createTransferHandler(stub, stub, stub),
  ].map((h) => ({ contractName: h.contractName, eventName: h.eventName }))
}

/** Load the REAL env loader (not the mock above) with CHAIN_ID unset. */
async function loadEnvWithoutChainId(): Promise<UnsetChainIdOutcome> {
  vi.resetModules()
  vi.stubEnv("CHAIN_ID", undefined)
  vi.stubEnv("FAST_RPC_URL", "http://127.0.0.1:1")
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:1")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "validate-integration-stub")
  try {
    const mod = await vi.importActual<typeof import("../config/env")>("../config/env")
    return { threw: false, chainId: mod.env.chainId }
  } catch {
    return { threw: true }
  }
}

function configuredChainId(): number | undefined {
  const raw = process.env.CHAIN_ID
  return raw === undefined || raw === "" ? undefined : Number(raw)
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("validate:integration", () => {
  it("sanity: the indexer config and handlers load", () => {
    expect(CONTRACTS_TO_INDEX.map((c) => c.name)).toEqual(["core", "bids"])
    expect(registeredHandlers().length).toBeGreaterThan(0)
    // The dynamic nft subscription decodes with viem's erc721Abi; the
    // generated Transfer event must be the same event.
    expect(erc721Abi.some((i) => i.type === "event" && i.name === "Transfer")).toBe(true)
  })

  // Test #7, part 1. KNOWN FAILURE: "core:ContractAuthorized" (renamed to
  // LaunchpadAuthorized on-chain). Fixed in Phase 3 (IDX-5 / ABI-4).
  it("(a) every CONTRACTS_TO_INDEX event exists in the generated events ABI", () => {
    expect(checkEventsExist(indexedContracts(), EVENTS_ABI_BY_CONTRACT)).toEqual([])
  })

  // Test #7, part 2.
  it("(b) HandlerRegistry handlers and config entries are 1:1", () => {
    expect(checkHandlerBijection(indexedContracts(), registeredHandlers())).toEqual([])
  })

  // KNOWN FAILURE: env.ts defaults CHAIN_ID to 11155111. Fixed in Phase 3 (ADDR-3).
  it("(c) CHAIN_ID is required and supported", async () => {
    const chainId = configuredChainId()
    const whenUnset = await loadEnvWithoutChainId()
    expect(checkChainId(whenUnset, chainId, SUPPORTED_CHAIN_IDS)).toEqual([])
  })

  // KNOWN FAILURE: indexer default 11155111 vs 99801 elsewhere. Fixed in Phase 3 (ADDR-3).
  it("(f) DEFAULT_CHAIN_ID is consistent across shared, contracts and indexer", async () => {
    const whenUnset = await loadEnvWithoutChainId()
    expect(
      checkDefaultChainIdConsistent({
        "packages/shared DEFAULT_CHAIN_ID": DEFAULT_CHAIN_ID,
        "packages/contracts DEFAULT_ADDRESSES_CHAIN_ID": DEFAULT_ADDRESSES_CHAIN_ID,
        "apps/indexer env CHAIN_ID default": whenUnset.threw ? undefined : whenUnset.chainId,
      }),
    ).toEqual([])
  })

  // Live; skipped unless --live. Never enabled in CI.
  it.skipIf(!process.env.VALIDATE_LIVE)("(d) eth_chainId of the indexer RPC equals CHAIN_ID [live]", async () => {
    const chainId = configuredChainId()
    const url = process.env.FAST_RPC_URL
    expect(chainId, "CHAIN_ID must be set for --live").toBeDefined()
    expect(url, "FAST_RPC_URL must be set in the shell for --live (no .env is read)").toBeTruthy()
    const actual = await createPublicClient({ transport: http(url) }).getChainId()
    expect(checkRpcChainId(chainId!, actual)).toEqual([])
  })
})
