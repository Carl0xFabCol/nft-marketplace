// IDX-1: Sale is the single source of collection volume/sales.
//
// On-chain, Bids.acceptTokenBid calls Core.executeSaleFromBid (emits Sale) and
// then emits TokenBidAccepted in the same tx; acceptCollectionBid calls it once
// per tokenId (N Sales) and then emits one CollectionBidAccepted with tokenIds[].
// These tests feed exactly that event shape through the real HandlerRegistry,
// handlers and repositories and count increment_collection_stats calls.
import { describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({ env: { chainId: 99801 } }))

import { BUYER, COLLECTION, SELLER, buildHarness, makeEvent } from "../test-utils/harness"
import { activityUniqueResponder } from "../test-utils/recordingSupabase"

const TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const
const PRICE = 50_000_000_000_000_000n // 0.05 ether

function sale(tokenId: bigint, price: bigint, logIndex: number) {
  return makeEvent(
    "core",
    "Sale",
    { collection: COLLECTION, tokenId, seller: SELLER, buyer: BUYER, price, marketplaceFeeAmount: 0n, royaltyAmount: 0n },
    { tx: TX, logIndex },
  )
}

function sumVolume(rpcs: { fn: string; args: Record<string, unknown> }[]): { volumeWei: bigint; sales: number } {
  let volumeWei = 0n
  let sales = 0
  for (const r of rpcs.filter((r) => r.fn === "increment_collection_stats")) {
    const [whole, frac = ""] = String(r.args.p_volume).split(".")
    volumeWei += BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, "0"))
    sales += r.args.p_sales as number
  }
  return { volumeWei, sales }
}

describe("IDX-1: bid acceptance increments stats exactly once per sold token", () => {
  it("token bid: Sale + TokenBidAccepted in one tx -> one increment", async () => {
    const { sb, registry } = buildHarness(activityUniqueResponder())
    await registry.dispatch(sale(7n, PRICE, 3))
    await registry.dispatch(
      makeEvent("bids", "TokenBidAccepted", { collection: COLLECTION, tokenId: 7n, bidder: BUYER, seller: SELLER, price: PRICE }, { tx: TX, logIndex: 4 }),
    )

    expect(sb.rpcs).toEqual([{ fn: "increment_collection_stats", args: { p_collection_address: COLLECTION, p_volume: "0.05", p_sales: 1 } }])
    // The bid-lifecycle writes and both activity rows are kept.
    expect(sb.payloads("activity", "upsert").map((a) => a.event)).toEqual(["SALE", "TOKEN_BID_ACCEPTED"])
    expect(sb.payloads("token_bids", "update")).toEqual([expect.objectContaining({ is_active: false })])
  })

  it("collection bid with N=3 tokenIds: 3 Sales + 1 CollectionBidAccepted -> 3 increments, not 6", async () => {
    const { sb, registry, bidsRepo } = buildHarness(activityUniqueResponder())
    vi.spyOn(bidsRepo, "getActiveCollectionBid").mockResolvedValue({ quantity: 5 })
    const tokenIds = [1n, 2n, 3n]
    let logIndex = 10
    for (const id of tokenIds) await registry.dispatch(sale(id, PRICE, logIndex++))
    await registry.dispatch(
      makeEvent(
        "bids",
        "CollectionBidAccepted",
        { collection: COLLECTION, bidder: BUYER, seller: SELLER, tokenIds, totalPrice: PRICE * 3n },
        { tx: TX, logIndex: logIndex++ },
      ),
    )

    const increments = sb.rpcs.filter((r) => r.fn === "increment_collection_stats")
    expect(increments).toHaveLength(3)
    expect(sumVolume(sb.rpcs)).toEqual({ volumeWei: PRICE * 3n, sales: 3 })
    // Partial fill bookkeeping is unchanged: 5 - 3 = 2 remaining.
    expect(sb.payloads("collection_bids", "update")).toEqual([expect.objectContaining({ quantity: 2 })])
  })

  it("a replayed Sale (activity row already present) does not increment again", async () => {
    const { sb, registry } = buildHarness(activityUniqueResponder())
    await registry.dispatch(sale(7n, PRICE, 3))
    await registry.dispatch(sale(7n, PRICE, 3))
    expect(sb.rpcs.filter((r) => r.fn === "increment_collection_stats")).toHaveLength(1)
  })

  it("a failed increment deletes the fresh activity row and rethrows, so the retry counts the Sale once", async () => {
    const { sb, registry } = buildHarness(activityUniqueResponder())
    let fail = true
    sb.setRpcResponder(() => (fail ? { data: null, error: new Error("transient") } : { data: null, error: null }))

    await expect(registry.dispatch(sale(7n, PRICE, 3))).rejects.toThrow("transient")
    const del = sb.queries.find((q) => q.table === "activity" && q.ops.some((o) => o.method === "delete"))
    expect(del?.ops.filter((o) => o.method === "eq").map((o) => o.args)).toEqual([
      ["tx_hash", TX],
      ["log_index", 3],
    ])

    fail = false
    await registry.dispatch(sale(7n, PRICE, 3))
    expect(sumVolume(sb.rpcs.slice(1))).toEqual({ volumeWei: PRICE, sales: 1 })
  })
})
