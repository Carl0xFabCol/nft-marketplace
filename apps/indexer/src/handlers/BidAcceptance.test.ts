// IDX-1: Sale is the single source of collection volume/sales.
//
// On-chain, Bids.acceptTokenBid calls Core.executeSaleFromBid (emits Sale) and
// then emits TokenBidAccepted in the same tx; acceptCollectionBid calls it once
// per tokenId (N Sales) and then emits one CollectionBidAccepted with tokenIds[].
// These tests feed exactly that event shape through the real HandlerRegistry,
// handlers and repositories over the in-memory DB model and check the stats
// written by the atomic indexer_record_sale RPC.
import { describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({ env: { chainId: 99801 } }))

import { BUYER, COLLECTION, SELLER, makeEvent } from "../test-utils/harness"
import { createMemoryDb } from "../test-utils/memoryDb"
import { wireHarness } from "../test-utils/harness"

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

/** Memory DB with one registered collection on 99801 (and the same address on another chain). */
function harnessWithCollection() {
  const db = createMemoryDb()
  db.tables.collections = [
    { chain_id: 99801, contract_address: COLLECTION, total_volume: "0", total_sales: 0 },
    { chain_id: 11155111, contract_address: COLLECTION, total_volume: "0", total_sales: 0 },
  ]
  return { db, ...wireHarness(db.sb) }
}

const stats = (db: ReturnType<typeof createMemoryDb>, chainId = 99801) => {
  const c = db.tables.collections.find((r) => r.chain_id === chainId)!
  return { volume: c.total_volume, sales: c.total_sales }
}
const saleCalls = (rpcs: { fn: string }[]) => rpcs.filter((r) => r.fn === "indexer_record_sale")

describe("IDX-1: bid acceptance increments stats exactly once per sold token", () => {
  it("token bid: Sale + TokenBidAccepted in one tx -> one increment", async () => {
    const { db, sb, registry } = harnessWithCollection()
    await registry.dispatch(sale(7n, PRICE, 3))
    await registry.dispatch(
      makeEvent("bids", "TokenBidAccepted", { collection: COLLECTION, tokenId: 7n, bidder: BUYER, seller: SELLER, price: PRICE }, { tx: TX, logIndex: 4 }),
    )

    expect(saleCalls(sb.rpcs)).toHaveLength(1)
    expect(stats(db)).toEqual({ volume: "0.05", sales: 1 })
    // Chain-scoped: the same address on another chain is untouched.
    expect(stats(db, 11155111)).toEqual({ volume: "0", sales: 0 })
    // The bid-lifecycle writes and both activity rows are kept.
    expect(db.tables.activity.map((a) => a.event)).toEqual(["SALE", "TOKEN_BID_ACCEPTED"])
    expect(sb.rpcs.filter((r) => r.fn === "indexer_apply_token_bid_event").map((r) => r.args.p_kind)).toEqual(["closed"])
  })

  it("collection bid with N=3 tokenIds: 3 Sales + 1 CollectionBidAccepted -> 3 increments, not 6", async () => {
    const { db, sb, registry } = harnessWithCollection()
    await registry.dispatch(
      makeEvent("bids", "CollectionBidPlaced", { collection: COLLECTION, bidder: BUYER, pricePerItem: PRICE, quantity: 5n, expiresAt: 0n }, { block: 90n, logIndex: 0 }),
    )
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

    expect(saleCalls(sb.rpcs)).toHaveLength(3)
    expect(stats(db)).toEqual({ volume: "0.15", sales: 3 })
    // Partial fill: 5 placed - 3 filled = 2 remaining, still active.
    expect(db.tables.collection_bids.map((b) => [b.quantity, b.is_active])).toEqual([[2, true]])
  })

  it("a replayed Sale (activity row already present) does not increment again", async () => {
    const { db, registry } = harnessWithCollection()
    await registry.dispatch(sale(7n, PRICE, 3))
    await registry.dispatch(sale(7n, PRICE, 3))
    expect(stats(db)).toEqual({ volume: "0.05", sales: 1 })
    expect(db.tables.activity).toHaveLength(1)
  })

  it("a failed sale RPC changes nothing and rethrows; the retry counts the Sale once", async () => {
    const { db, registry } = harnessWithCollection()
    db.failNextRpc("transient")

    await expect(registry.dispatch(sale(7n, PRICE, 3))).rejects.toMatchObject({ message: "transient" })
    expect(db.tables.activity ?? []).toHaveLength(0)
    expect(stats(db)).toEqual({ volume: "0", sales: 0 })

    await registry.dispatch(sale(7n, PRICE, 3))
    expect(stats(db)).toEqual({ volume: "0.05", sales: 1 })
  })
})
