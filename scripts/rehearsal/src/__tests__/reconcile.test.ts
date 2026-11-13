// Offline tests for the reconciliation diff (no chain, no DB). Each mutation
// is a defect the Phase 7 job must catch; the clean snapshot must be silent.
import { describe, expect, it } from "vitest"
import { activityType, diff, etherTextToWei, expectedActivityPrice, isIndexed, type ChainSnapshot, type DbSnapshot } from "../reconcile"

const COL = "0x00000000000000000000000000000000000000c1"
const ALICE = "0x00000000000000000000000000000000000000a1"
const BOB = "0x00000000000000000000000000000000000000b0"
const ZERO = "0x0000000000000000000000000000000000000000"
const T = 1_800_000_000n
const iso = (s: bigint) => new Date(Number(s) * 1000).toISOString()

function clean(): { chain: ChainSnapshot; db: DbSnapshot } {
  const chain: ChainSnapshot = {
    atBlock: 120n,
    logs: [
      { source: "core", contract: "core", eventName: "CollectionRegistered", args: { collection: COL }, txHash: "0x01", logIndex: 0, blockNumber: 101n, blockTimestamp: T },
      { source: "core", contract: "core", eventName: "CollectionRegistrationExecuted", args: {}, txHash: "0x01", logIndex: 1, blockNumber: 101n, blockTimestamp: T },
      { source: "collection", contract: COL, eventName: "Transfer", args: { from: ZERO, to: ALICE, tokenId: 1n }, txHash: "0x02", logIndex: 0, blockNumber: 102n, blockTimestamp: T + 1n },
      { source: "core", contract: "core", eventName: "ListingCreated", args: { collection: COL, tokenId: 1n, price: 1234567890123456789n }, txHash: "0x03", logIndex: 0, blockNumber: 103n, blockTimestamp: T + 2n },
      { source: "core", contract: "core", eventName: "RoyaltySourceUsed", args: {}, txHash: "0x04", logIndex: 0, blockNumber: 104n, blockTimestamp: T + 3n },
      { source: "core", contract: "core", eventName: "Sale", args: { price: 5n }, txHash: "0x04", logIndex: 1, blockNumber: 104n, blockTimestamp: T + 3n },
      { source: "bids", contract: "bids", eventName: "CollectionBidPlaced", args: { pricePerItem: 7n }, txHash: "0x05", logIndex: 0, blockNumber: 105n, blockTimestamp: T + 4n },
    ],
    collections: [{ address: COL, registeredAtBlock: 101n, volumeWei: 5n, sales: 1, verified: true, exists: true, storedRoyaltyBps: 200, overridden: false }],
    listings: [{ collection: COL, tokenId: "1", seller: ALICE, price: 1234567890123456789n, listedAt: T + 2n, expiresAt: T + 1000n, feeBps: 250, royaltyBps: 500 }],
    tokenBids: [{ collection: COL, tokenId: "1", bidder: BOB, price: 0n, expiresAt: 0n }],
    collectionBids: [{ collection: COL, bidder: BOB, pricePerItem: 7n, quantity: 2, expiresAt: 0n }],
    tokens: [{ collection: COL, tokenId: "1", owner: ALICE, lastTransferTo: ALICE }],
  }
  const a = (event: string, tx: string, li: number, ts: bigint, price: string | null = null) => ({ event, tx_hash: tx, log_index: String(li), created_at: iso(ts), collection_address: COL, token_id: null, price, chain_id: 31337 })
  const db: DbSnapshot = {
    lastBlock: 120n,
    activity: [
      a("COLLECTION_REGISTERED", "0x01", 0, T),
      a("TRANSFER", "0x02", 0, T + 1n),
      a("LISTING_CREATED", "0x03", 0, T + 2n, "1234567890123456789"),
      a("SALE", "0x04", 1, T + 3n, "5"),
      a("COLLECTION_BID_PLACED", "0x05", 0, T + 4n, "7"),
    ],
    collections: [{ contract_address: COL, total_volume: "0.000000000000000005", total_sales: "1", is_verified: true, royalty_fee: 200 }],
    listings: [{ collection_address: COL, token_id: "1", seller_wallet: ALICE, price: "1234567890123456789", is_active: true, expires_at: iso(T + 1000n), listed_at: iso(T + 2n) }],
    tokenBids: [{ collection_address: COL, token_id: "1", bidder_wallet: BOB, price: "9", is_active: false, expires_at: null }],
    collectionBids: [{ collection_address: COL, bidder_wallet: BOB, price: "7", quantity: "2", is_active: true, expires_at: null }],
    nfts: [{ collection_address: COL, token_id: "1", owner_wallet: ALICE }],
  }
  return { chain, db }
}

const fields = (s: ReturnType<typeof clean>) => diff(s.chain, s.db).mismatches.map((m) => `${m.area}:${m.field}`)

describe("reconcile diff", () => {
  it("a consistent snapshot has no mismatches", () => {
    const r = diff(clean().chain, clean().db)
    expect(r.mismatches).toEqual([])
    expect(r.counts.indexedLogs).toBe(5)
    expect(r.counts.perType.SALE).toEqual({ chain: 1, db: 1 })
  })

  it("catches a Sale counted twice (two rows for one log)", () => {
    const s = clean()
    s.db.activity.push({ ...s.db.activity[3] })
    expect(fields(s)).toContain("activity:rows for Sale")
  })

  it("catches a row written for an unindexed event (RoyaltySourceUsed / CollectionRegistrationExecuted)", () => {
    const s = clean()
    s.db.activity.push({ ...s.db.activity[0], event: "ROYALTY_SOURCE_USED", tx_hash: "0x04", log_index: "0" })
    s.db.activity.push({ ...s.db.activity[0], event: "COLLECTION_REGISTRATION_EXECUTED", log_index: "1" })
    expect(fields(s).filter((f) => f.startsWith("activity:row for unindexed"))).toHaveLength(2)
  })

  it("catches a missing activity row, a wrong type, a wrong price and a wrong timestamp", () => {
    const s = clean()
    s.db.activity.splice(1, 1)
    s.db.activity[0].event = "COLLECTION_VERIFIED"
    s.db.activity[1].price = "1234567890123456800" // the float-rounded value
    s.db.activity[2].created_at = iso(0n)
    expect(fields(s)).toEqual(expect.arrayContaining(["activity:rows for Transfer", "activity:event", "activity:price", "activity:created_at (block timestamp)"]))
  })

  it("catches an extra row with no log in range", () => {
    const s = clean()
    s.db.activity.push({ ...s.db.activity[0], tx_hash: "0x99" })
    expect(fields(s)).toContain("activity:row without an indexed log in range")
  })

  it("total_volume is compared in wei with no tolerance (1 wei off is a mismatch)", () => {
    const s = clean()
    s.db.collections[0].total_volume = "0.000000000000000006"
    expect(fields(s)).toEqual(["collections:total_volume (wei)"])
    expect(etherTextToWei("1.234567890123456789")).toBe(1234567890123456789n)
    expect(etherTextToWei("0.215")).toBe(215000000000000000n)
  })

  it("catches sales, verification and royalty drift, and an unregistered DB collection", () => {
    const s = clean()
    s.db.collections[0].total_sales = "2"
    s.db.collections[0].is_verified = false
    s.db.collections[0].royalty_fee = 0
    s.db.collections.push({ contract_address: "0xdead", total_volume: "0", total_sales: "0", is_verified: false, royalty_fee: 0 })
    expect(fields(s)).toEqual(["collections:total_sales", "collections:is_verified", "collections:royalty_fee (Core stored bps)", "collections:row"])
  })

  it("listings: active flag, seller, price and expiry from the 6-field struct", () => {
    const s = clean()
    s.db.listings[0].price = "1"
    s.db.listings[0].expires_at = iso(T)
    expect(fields(s)).toEqual(["listings:price", "listings:expires_at"])
    s.chain.listings[0].seller = ZERO // cancelled/sold on-chain, still active in the DB
    expect(fields(s)).toEqual(["listings:is_active"])
  })

  it("bids: an active DB row for an empty slot, a wrong remaining quantity, a duplicate active row", () => {
    const s = clean()
    s.db.tokenBids[0].is_active = true
    s.db.collectionBids[0].quantity = "3"
    expect(fields(s)).toEqual(["token_bids:active rows", "collection_bids:remaining quantity"])
    const d = clean()
    d.db.collectionBids.push({ ...d.db.collectionBids[0] })
    expect(fields(d)).toEqual(["collection_bids:active rows"])
  })

  it("nfts: owner drift and missing rows", () => {
    const s = clean()
    s.db.nfts[0].owner_wallet = BOB
    expect(fields(s)).toEqual(["nfts:owner_wallet"])
    s.db.nfts = []
    expect(fields(s)).toEqual(["nfts:row"])
  })

  it("the cursor must be the pinned block", () => {
    const s = clean()
    s.db.lastBlock = 119n
    expect(fields(s)).toEqual(["cursor:last_block"])
  })

  it("maps event names to the indexer's activity types and coverage", () => {
    expect(activityType({ eventName: "CollectionRoyaltyUpdated", args: {} })).toBe("COLLECTION_ROYALTY_UPDATED")
    expect(activityType({ eventName: "Sale", args: {} })).toBe("SALE")
    expect(activityType({ eventName: "LaunchpadAuthorized", args: { authorized: false } })).toBe("LAUNCHPAD_DEAUTHORIZED")
    expect(isIndexed({ source: "core", eventName: "RoyaltySourceUsed" })).toBe(false)
    expect(isIndexed({ source: "core", eventName: "CollectionRegistrationExecuted" })).toBe(false)
    expect(isIndexed({ source: "bids", eventName: "Withdrawal" })).toBe(true)
    expect(expectedActivityPrice({ eventName: "Withdrawal", args: { amount: 3n } })).toBe("3")
    // The handler stores the acceptance's TOTAL, as the event carries it.
    expect(expectedActivityPrice({ eventName: "CollectionBidAccepted", args: { totalPrice: 9n } })).toBe("9")
    expect(expectedActivityPrice({ eventName: "ListingUpdated", args: { newPrice: 4n } })).toBe("4")
  })
})
