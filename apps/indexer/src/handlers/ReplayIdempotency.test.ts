// Test #11 (INTEGRATION_AUDIT §10): process the same block range twice and
// assert identical row counts, collections.total_volume and total_sales.
//
// Proven here at handler level (real registry, handlers and repositories over
// an in-memory model of the Phase 1+2+3B tables and indexer RPCs): activity,
// listings, nfts, collections (verification, royalty, stats), and since Phase
// 3B (IDX-6 / IDX-7, migration 20261028091400) token_bids, collection_bids and
// the collection_bid_fills ledger:
//   - bid placements are keyed on (chain_id, tx_hash, log_index), so a replay
//     adds no rows;
//   - remaining collection-bid quantity = placed_quantity - recorded fills, so
//     replaying an acceptance cannot decrement twice (test #14);
//   - every bid write is chain-scoped (test #15).
// The same properties are checked against real Postgres in
// src/__localdb__/bidEvents.localdb.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({ env: { chainId: 99801 } }))

import { formatEther, type Address } from "viem"
import { BUYER, COLLECTION, SELLER, TS, makeEvent, wireHarness } from "../test-utils/harness"
import { BidsRepository } from "../persistence/BidsRepository"
import { createMemoryDb } from "../test-utils/memoryDb"
import type { ParsedEvent } from "../types/indexer.types"

const ZERO = "0x0000000000000000000000000000000000000000" as Address
const BIDDER = "0x00000000000000000000000000000000000000b1" as Address
const LAUNCHPAD = "0x00000000000000000000000000000000000000d1" as Address
const WEI_1 = 1234567890123456789n // > 2^53, exercises IDX-4 on the way
const WEI_TB = 50_000_000_000_000_000n
const WEI_CB = 10_000_000_000_000_000n

const TS_MS = TS * 1000
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`

/** One realistic block range, in on-chain order, with stable (tx, logIndex). */
function blockRange(): ParsedEvent[] {
  let li = 0
  const e = <T,>(contract: string, name: string, args: T, txN: number, block: bigint) =>
    makeEvent(contract, name, args, { tx: tx(txN), logIndex: li++, block }) as ParsedEvent
  const sale = (tokenId: bigint, price: bigint, buyer: Address, txN: number, block: bigint) =>
    e("core", "Sale", { collection: COLLECTION, tokenId, seller: SELLER, buyer, price, marketplaceFeeAmount: 0n, royaltyAmount: 0n }, txN, block)

  return [
    e("core", "CollectionRegistered", { collection: COLLECTION, owner: SELLER, royaltyFee: 500, isVerified: false }, 1, 100n),
    ...[1n, 2n, 3n, 4n].map((id) => e("nft", "Transfer", { from: ZERO, to: SELLER, tokenId: id }, 2, 101n)),
    e("core", "ListingCreated", { collection: COLLECTION, tokenId: 1n, seller: SELLER, price: WEI_1, expiresAt: 0n }, 3, 102n),
    e("core", "ListingUpdated", { collection: COLLECTION, tokenId: 1n, newPrice: WEI_1 + 1n }, 4, 103n),
    e("core", "ListingCreated", { collection: COLLECTION, tokenId: 2n, seller: SELLER, price: WEI_CB, expiresAt: 0n }, 5, 103n),
    e("core", "ListingCancelled", { collection: COLLECTION, tokenId: 2n, seller: SELLER }, 6, 104n),
    // Buy of token 1
    e("nft", "Transfer", { from: SELLER, to: BUYER, tokenId: 1n }, 7, 105n),
    sale(1n, WEI_1 + 1n, BUYER, 7, 105n),
    // Token bid on 3, accepted: Sale + TokenBidAccepted in one tx
    e("bids", "TokenBidPlaced", { collection: COLLECTION, tokenId: 3n, bidder: BIDDER, price: WEI_TB, expiresAt: 0n }, 8, 106n),
    e("nft", "Transfer", { from: SELLER, to: BIDDER, tokenId: 3n }, 9, 107n),
    sale(3n, WEI_TB, BIDDER, 9, 107n),
    e("bids", "TokenBidAccepted", { collection: COLLECTION, tokenId: 3n, bidder: BIDDER, seller: SELLER, price: WEI_TB }, 9, 107n),
    // Collection bid for 3, accepted for tokens 2 and 4: 2 Sales + 1 CollectionBidAccepted
    e("bids", "CollectionBidPlaced", { collection: COLLECTION, bidder: BIDDER, pricePerItem: WEI_CB, quantity: 3n, expiresAt: 0n }, 10, 108n),
    e("nft", "Transfer", { from: SELLER, to: BIDDER, tokenId: 2n }, 11, 109n),
    sale(2n, WEI_CB, BIDDER, 11, 109n),
    e("nft", "Transfer", { from: SELLER, to: BIDDER, tokenId: 4n }, 11, 109n),
    sale(4n, WEI_CB, BIDDER, 11, 109n),
    e("bids", "CollectionBidAccepted", { collection: COLLECTION, bidder: BIDDER, seller: SELLER, tokenIds: [2n, 4n], totalPrice: WEI_CB * 2n }, 11, 109n),
    // Admin / IDX-5
    e("core", "CollectionVerified", { collection: COLLECTION }, 12, 110n),
    e("core", "CollectionUnverified", { collection: COLLECTION }, 13, 111n),
    e("core", "CollectionRoyaltyUpdated", { collection: COLLECTION, royaltyReceiver: SELLER, royaltyFee: 750 }, 14, 112n),
    e("core", "RoyaltyOverrideCleared", { collection: COLLECTION }, 15, 113n),
    e("core", "LaunchpadAuthorized", { launchpad: LAUNCHPAD, authorized: true }, 16, 114n),
    e("core", "Withdrawal", { account: SELLER, amount: WEI_1 }, 17, 115n),
    e("bids", "Withdrawal", { account: SELLER, amount: WEI_TB }, 18, 115n),
  ]
}

const IDEMPOTENT_TABLES = ["activity", "listings", "nfts", "collections", "token_bids", "collection_bids", "collection_bid_fills"]

beforeEach(() => {
  // ListingCreated stamps updated_at with the wall clock; pin it.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

async function run(registry: ReturnType<typeof wireHarness>["registry"], events: ParsedEvent[]) {
  for (const event of events) await registry.dispatch(event)
}

describe("test #11: replaying the same block range is idempotent (handler level)", () => {
  it("activity, listings, nfts, collections (incl. total_volume/total_sales) and bids are identical after a replay", async () => {
    const db = createMemoryDb()
    const { registry } = wireHarness(db.sb)
    const events = blockRange()

    await run(registry, events)
    const first = db.snapshot(IDEMPOTENT_TABLES)
    await run(registry, events)

    expect(db.snapshot(IDEMPOTENT_TABLES)).toBe(first)

    // And the stats are right, not just stable: 4 Sales, exact wei sum (IDX-1 + IDX-4).
    const [collection] = db.tables.collections
    expect(collection.total_sales).toBe(4)
    expect(collection.total_volume).toBe(formatEther(WEI_1 + 1n + WEI_TB + 2n * WEI_CB)) // "1.30456789012345679"
    expect(collection).toMatchObject({ is_verified: false, royalty_fee: 750 })

    expect(db.tables.activity).toHaveLength(events.length)
    expect(db.tables.listings.map((l) => [l.token_id, l.is_active, l.price])).toEqual([
      ["1", false, (WEI_1 + 1n).toString()],
      ["2", false, WEI_CB.toString()],
    ])
    expect(Object.fromEntries(db.tables.nfts.map((n) => [n.token_id, n.owner_wallet]))).toEqual({ "1": BUYER, "2": BIDDER, "3": BIDDER, "4": BIDDER })
  })

  it("a partial replay (only the last blocks, as after a failure at block B) does not change stats", async () => {
    const db = createMemoryDb()
    const { registry } = wireHarness(db.sb)
    const events = blockRange()
    await run(registry, events)
    const first = db.snapshot(IDEMPOTENT_TABLES)

    await run(registry, events.filter((e) => e.blockNumber >= 107n))
    expect(db.snapshot(IDEMPOTENT_TABLES)).toBe(first)
  })
})

describe("IDX-7: bid tables are replay-safe (Phase 3B)", () => {
  it("one pass leaves the expected bid rows", async () => {
    const db = createMemoryDb()
    const { registry } = wireHarness(db.sb)
    await run(registry, blockRange())
    expect(db.tables.token_bids.map((b) => [b.token_id, b.is_active])).toEqual([["3", false]])
    expect(db.tables.collection_bids.map((b) => [b.placed_quantity, b.quantity, b.is_active])).toEqual([[3, 1, true]]) // 3 - 2
    expect(db.tables.collection_bid_fills.map((f) => f.token_count)).toEqual([2])
  })

  it("token_bids / collection_bids row counts and contents are unchanged by a replay", async () => {
    const db = createMemoryDb()
    const { registry } = wireHarness(db.sb)
    const events = blockRange()
    await run(registry, events)
    const first = db.snapshot(["token_bids", "collection_bids", "collection_bid_fills"])
    await run(registry, events)
    expect(db.snapshot(["token_bids", "collection_bids", "collection_bid_fills"])).toBe(first)
  })

  it("test #14: replaying only a collection-bid acceptance leaves the remaining quantity unchanged", async () => {
    const db = createMemoryDb()
    const { registry } = wireHarness(db.sb)
    const events = blockRange()
    await run(registry, events)
    const before = db.tables.collection_bids.map((b) => [b.quantity, b.is_active])

    await run(registry, events.filter((e) => e.eventName === "CollectionBidAccepted"))
    expect(db.tables.collection_bids.map((b) => [b.quantity, b.is_active])).toEqual(before)
  })

  it("test #14: the remaining quantity follows the events, partial then full fill", async () => {
    const db = createMemoryDb()
    const { registry } = wireHarness(db.sb)
    const place = makeEvent(
      "bids",
      "CollectionBidPlaced",
      { collection: COLLECTION, bidder: BIDDER, pricePerItem: WEI_CB, quantity: 3n, expiresAt: 0n },
      { tx: tx(50), block: 200n, logIndex: 0 },
    )
    const fill = (n: number, ids: bigint[]) =>
      makeEvent(
        "bids",
        "CollectionBidAccepted",
        { collection: COLLECTION, bidder: BIDDER, seller: SELLER, tokenIds: ids, totalPrice: WEI_CB * BigInt(ids.length) },
        { tx: tx(n), block: BigInt(200 + n), logIndex: 0 },
      )
    await run(registry, [place, fill(51, [1n])])
    expect(db.tables.collection_bids.map((b) => [b.quantity, b.is_active])).toEqual([[2, true]])
    await run(registry, [fill(52, [2n, 3n])])
    expect(db.tables.collection_bids.map((b) => [b.quantity, b.is_active])).toEqual([[0, false]])
    // Replaying the whole sequence changes nothing.
    await run(registry, [place, fill(51, [1n]), fill(52, [2n, 3n])])
    expect(db.tables.collection_bids.map((b) => [b.quantity, b.is_active])).toEqual([[0, false]])
  })

  it("a replayed cancel never closes a later placement", async () => {
    const db = createMemoryDb()
    const { registry } = wireHarness(db.sb)
    const place = (n: number, qty: bigint) =>
      makeEvent(
        "bids",
        "CollectionBidPlaced",
        { collection: COLLECTION, bidder: BIDDER, pricePerItem: WEI_CB, quantity: qty, expiresAt: 0n },
        { tx: tx(n), block: BigInt(300 + n), logIndex: 0 },
      )
    const cancel = makeEvent("bids", "CollectionBidCancelled", { collection: COLLECTION, bidder: BIDDER }, { tx: tx(61), block: 361n, logIndex: 0 })
    const tokenPlace = (n: number) =>
      makeEvent(
        "bids",
        "TokenBidPlaced",
        { collection: COLLECTION, tokenId: 9n, bidder: BIDDER, price: WEI_TB, expiresAt: 0n },
        { tx: tx(n), block: BigInt(300 + n), logIndex: 1 },
      )
    const tokenCancel = makeEvent("bids", "TokenBidCancelled", { collection: COLLECTION, tokenId: 9n, bidder: BIDDER }, { tx: tx(61), block: 361n, logIndex: 1 })

    await run(registry, [place(60, 2n), tokenPlace(60), cancel, tokenCancel, place(62, 5n), tokenPlace(62)])
    // Replay from the cancel on (the retry after a failure at block 361).
    await run(registry, [cancel, tokenCancel, place(62, 5n), tokenPlace(62)])

    expect(db.tables.collection_bids.map((b) => [b.placed_quantity, b.is_active])).toEqual([
      [2, false],
      [5, true],
    ])
    expect(db.tables.token_bids.map((b) => [b.block_number, b.is_active])).toEqual([
      ["360", false],
      ["362", true],
    ])
  })
})

describe("test #15: cross-chain bid isolation (IDX-6)", () => {
  it("cancelling or filling on one chain never touches the same (collection, bidder) on another chain", async () => {
    const db = createMemoryDb()
    const { registry } = wireHarness(db.sb) // indexes chain 99801
    const sepolia = new BidsRepository(db.sb.client, 11155111)
    const at = new Date(TS_MS)

    // The same collection and bidder bid on both chains.
    await sepolia.placeCollectionBid({ collectionAddress: COLLECTION, bidderWallet: BIDDER }, { blockNumber: 10n, logIndex: 0, txHash: tx(70) }, at, {
      price: "1",
      quantity: 4,
      expiresAt: null,
    })
    await sepolia.placeTokenBid({ collectionAddress: COLLECTION, tokenId: "9", bidderWallet: BIDDER }, { blockNumber: 10n, logIndex: 1, txHash: tx(70) }, at, {
      price: "1",
      expiresAt: null,
    })
    await run(registry, [
      makeEvent("bids", "CollectionBidPlaced", { collection: COLLECTION, bidder: BIDDER, pricePerItem: WEI_CB, quantity: 3n, expiresAt: 0n }, { tx: tx(71), block: 400n, logIndex: 0 }),
      makeEvent("bids", "TokenBidPlaced", { collection: COLLECTION, tokenId: 9n, bidder: BIDDER, price: WEI_TB, expiresAt: 0n }, { tx: tx(71), block: 400n, logIndex: 1 }),
      makeEvent("bids", "CollectionBidAccepted", { collection: COLLECTION, bidder: BIDDER, seller: SELLER, tokenIds: [1n], totalPrice: WEI_CB }, { tx: tx(72), block: 401n, logIndex: 0 }),
      makeEvent("bids", "TokenBidCancelled", { collection: COLLECTION, tokenId: 9n, bidder: BIDDER }, { tx: tx(73), block: 402n, logIndex: 0 }),
    ])

    const byChain = (rows: Record<string, unknown>[]) => Object.fromEntries(rows.map((r) => [r.chain_id as number, [r.quantity ?? null, r.is_active]]))
    expect(byChain(db.tables.collection_bids)).toEqual({ 99801: [2, true], 11155111: [4, true] })
    expect(byChain(db.tables.token_bids)).toEqual({ 99801: [null, false], 11155111: [null, true] })
    expect(db.tables.collection_bid_fills.map((f) => f.chain_id)).toEqual([99801])

    await run(registry, [makeEvent("bids", "CollectionBidCancelled", { collection: COLLECTION, bidder: BIDDER }, { tx: tx(74), block: 403n, logIndex: 0 })])
    expect(byChain(db.tables.collection_bids)).toEqual({ 99801: [2, false], 11155111: [4, true] })
  })
})
