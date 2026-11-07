// IDX-5 event coverage: test #16 plus the new listeners, the decode path and
// the IDX-12 "deliberately not indexed" guard. Runs the real config, fetcher,
// registry, handlers and repositories over fakes; no network, no database.
import { describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({ env: { chainId: 99801, batchSize: 1000, maxParallelRequests: 1 } }))

import { encodeAbiParameters, encodeEventTopics, type Abi } from "viem"
import { MarketplaceBidsEventsAbi, MarketplaceCoreEventsAbi } from "@marketplace/contracts/abis/generated/events"
import { CONTRACTS_TO_INDEX } from "../config/contracts.config"
import { BatchEventFetcher } from "../fetchers/BatchEventFetcher"
import type { RawContractEvent } from "../types/indexer.types"
import { BUYER, COLLECTION, SELLER, TS, buildHarness, makeEvent } from "../test-utils/harness"
import { activityUniqueResponder } from "../test-utils/recordingSupabase"

const LAUNCHPAD = "0x00000000000000000000000000000000000000d1"

function eqs(sb: ReturnType<typeof buildHarness>["sb"], table: string) {
  return sb.queries.filter((q) => q.table === table && q.ops.some((o) => o.method === "update")).map((q) => q.ops.filter((o) => o.method === "eq").map((o) => o.args))
}

describe("test #16: CollectionUnverified clears the verified flag (IDX-5)", () => {
  it("verify then unverify writes is_verified true, then false, chain-scoped", async () => {
    const { sb, registry } = buildHarness(activityUniqueResponder())
    await registry.dispatch(makeEvent("core", "CollectionVerified", { collection: COLLECTION }))
    await registry.dispatch(makeEvent("core", "CollectionUnverified", { collection: COLLECTION }))

    expect(sb.payloads("collections", "update").map((u) => u.is_verified)).toEqual([true, false])
    for (const filters of eqs(sb, "collections")) {
      expect(filters).toEqual([
        ["chain_id", 99801],
        ["contract_address", COLLECTION],
      ])
    }
    expect(sb.payloads("activity", "upsert").map((a) => a.event)).toEqual(["COLLECTION_VERIFIED", "COLLECTION_UNVERIFIED"])
  })
})

describe("new IDX-5 handlers", () => {
  it("CollectionRoyaltyUpdated sets collections.royalty_fee (bps) and records the receiver", async () => {
    const { sb, registry } = buildHarness(activityUniqueResponder())
    await registry.dispatch(makeEvent("core", "CollectionRoyaltyUpdated", { collection: COLLECTION, royaltyReceiver: SELLER, royaltyFee: 750 }))

    expect(sb.payloads("collections", "update")).toEqual([{ royalty_fee: 750, updated_at: new Date(TS * 1000) }])
    expect(eqs(sb, "collections")).toEqual([
      [
        ["chain_id", 99801],
        ["contract_address", COLLECTION],
      ],
    ])
    expect(sb.payloads("activity", "upsert")).toEqual([expect.objectContaining({ event: "COLLECTION_ROYALTY_UPDATED", to: SELLER })])
  })

  it("RoyaltyOverrideCleared writes only an activity row (no column for the override flag yet)", async () => {
    const { sb, registry } = buildHarness(activityUniqueResponder())
    await registry.dispatch(makeEvent("core", "RoyaltyOverrideCleared", { collection: COLLECTION }))

    expect(sb.queries.map((q) => q.table)).toEqual(["activity"])
    expect(sb.payloads("activity", "upsert")).toEqual([expect.objectContaining({ event: "ROYALTY_OVERRIDE_CLEARED", collection_address: COLLECTION })])
  })

  it("LaunchpadAuthorized encodes the boolean in the event name, not in price", async () => {
    const { sb, registry } = buildHarness(activityUniqueResponder())
    await registry.dispatch(makeEvent("core", "LaunchpadAuthorized", { launchpad: LAUNCHPAD, authorized: true }))
    await registry.dispatch(makeEvent("core", "LaunchpadAuthorized", { launchpad: LAUNCHPAD, authorized: false }))

    const rows = sb.payloads("activity", "upsert")
    expect(rows.map((r) => r.event)).toEqual(["LAUNCHPAD_AUTHORIZED", "LAUNCHPAD_DEAUTHORIZED"])
    expect(rows.every((r) => r.to === LAUNCHPAD && r.price === undefined)).toBe(true)
  })

  it.each(["core", "bids"])("%s Withdrawal writes an activity row with the exact amount", async (contractName) => {
    const { sb, registry } = buildHarness(activityUniqueResponder())
    await registry.dispatch(makeEvent(contractName, "Withdrawal", { account: BUYER, amount: 1234567890123456789n }))

    expect(sb.queries.map((q) => q.table)).toEqual(["activity"])
    expect(sb.payloads("activity", "upsert")).toEqual([
      expect.objectContaining({ event: "WITHDRAWAL", to: BUYER, price: "1234567890123456789", source_contract: contractName }),
    ])
  })
})

describe("decode path: configured events reach their handlers", () => {
  function rawLog(abi: Abi, eventName: string, indexed: Record<string, unknown>, data: { types: { type: string }[]; values: unknown[] }, logIndex: number): RawContractEvent {
    return {
      address: "0x0000000000000000000000000000000000000c0e",
      topics: encodeEventTopics({ abi, eventName, args: indexed } as never) as `0x${string}`[],
      data: data.types.length ? encodeAbiParameters(data.types as never, data.values as never) : "0x",
      blockNumber: 100n,
      blockTimestamp: BigInt(TS),
      transactionHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      logIndex,
    }
  }

  it("CollectionUnverified, RoyaltyOverrideCleared and Withdrawal decode with the indexer's config", async () => {
    const core = CONTRACTS_TO_INDEX.find((c) => c.name === "core")!
    const logs = [
      rawLog(MarketplaceCoreEventsAbi, "CollectionUnverified", { collection: COLLECTION }, { types: [], values: [] }, 0),
      rawLog(MarketplaceCoreEventsAbi, "RoyaltyOverrideCleared", { collection: COLLECTION }, { types: [], values: [] }, 1),
      rawLog(MarketplaceCoreEventsAbi, "Withdrawal", { account: BUYER }, { types: [{ type: "uint256" }], values: [5n] }, 2),
    ]
    const provider = { name: "fake", getContractEvents: vi.fn(async () => logs) }
    const events = await new BatchEventFetcher(provider as never, 1000, 1).fetchEventsForContracts([{ contract: core, fromBlock: 100n }], 100n)

    expect(events.map((e) => e.eventName)).toEqual(["CollectionUnverified", "RoyaltyOverrideCleared", "Withdrawal"])
    const { registry } = buildHarness(activityUniqueResponder())
    for (const e of events) expect(registry.hasHandler(e.contractName, e.eventName)).toBe(true)
  })
})

describe("IDX-12 guard: events that must stay unindexed", () => {
  const NEVER = ["CollectionRegistrationExecuted", "RoyaltySourceUsed"]

  it("they exist in the Core ABI (so the guard is meaningful)", () => {
    const names = new Set<string>(MarketplaceCoreEventsAbi.filter((i) => i.type === "event").map((i) => i.name))
    for (const n of NEVER) expect(names.has(n)).toBe(true)
  })

  it("are neither configured nor handled", () => {
    const configured = CONTRACTS_TO_INDEX.flatMap((c) => c.events)
    const { registry } = buildHarness()
    for (const n of NEVER) {
      expect(configured).not.toContain(n)
      expect(registry.hasHandler("core", n)).toBe(false)
    }
  })

  it("the stale ContractAuthorized is gone from config and handlers", () => {
    const { registry } = buildHarness()
    expect(CONTRACTS_TO_INDEX.flatMap((c) => c.events)).not.toContain("ContractAuthorized")
    expect(registry.hasHandler("core", "ContractAuthorized")).toBe(false)
  })

  it("every configured core/bids event decodes with the generated ABI it is fetched with", () => {
    const abiByName: Record<string, Abi> = { core: MarketplaceCoreEventsAbi, bids: MarketplaceBidsEventsAbi }
    for (const c of CONTRACTS_TO_INDEX) {
      expect(c.abi).toBe(abiByName[c.name])
      const names = new Set((c.abi as Abi).filter((i) => i.type === "event").map((i) => (i as { name: string }).name))
      for (const e of c.events) expect(names.has(e), `${c.name}:${e}`).toBe(true)
    }
  })
})
