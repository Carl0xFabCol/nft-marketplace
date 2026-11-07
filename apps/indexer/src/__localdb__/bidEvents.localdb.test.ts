// Phase 3B task 3 on a real local database (migrations 20261028091200 and
// 091400), through the real HandlerRegistry, handlers and repositories:
//   #11 replaying a range (full and partial) leaves bids, fills, activity and
//       stats identical;
//   #14 remaining collection-bid quantity comes from recorded fills;
//   #15 bids on another chain are never touched.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Address } from "viem"
import type { ParsedEvent } from "../types/indexer.types"
import { HAS_LOCALDB, localClient, testAddress, testTxHash } from "./localdb"

describe.runIf(HAS_LOCALDB)("bid events on a real database (#11, #14, #15)", () => {
  const collection = testAddress("bids") as Address
  const seller = "0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294" as Address
  const bidder = "0x00000000000000000000000000000000000000b1" as Address
  const WEI_TB = 50_000_000_000_000_000n
  const WEI_CB = 1_234_567_890_123_456_789n
  const tx = (n: number) => testTxHash("bids", n) as `0x${string}`
  const hashes = Array.from({ length: 40 }, (_, i) => tx(i))

  let harness: Awaited<ReturnType<typeof load>>
  async function load() {
    const { wireHarness, makeEvent } = await import("../test-utils/harness")
    const { BidsRepository } = await import("../persistence/BidsRepository")
    const client = localClient()
    return { ...wireHarness({ client } as never), makeEvent, BidsRepository, client }
  }

  beforeAll(async () => {
    harness = await load()
    const sb = harness.client
    const c = await sb.from("collections").insert([
      { chain_id: 99801, contract_address: collection, total_volume: 0, total_sales: 0 },
      { chain_id: 11155111, contract_address: collection, total_volume: 0, total_sales: 0 },
    ])
    if (c.error) throw c.error
    const n = await sb
      .from("nfts")
      .insert([1, 2, 3, 4].map((id) => ({ chain_id: 99801, collection_address: collection, token_id: String(id), owner_wallet: seller })))
    if (n.error) throw n.error
  })

  afterAll(async () => {
    const sb = localClient()
    await sb.from("activity").delete().in("tx_hash", hashes)
    await sb.from("collection_bids").delete().eq("collection_address", collection) // fills cascade
    await sb.from("token_bids").delete().eq("collection_address", collection)
    await sb.from("listings").delete().eq("collection_address", collection)
    await sb.from("nfts").delete().eq("collection_address", collection)
    await sb.from("collections").delete().eq("contract_address", collection)
  })

  function range(): ParsedEvent[] {
    const e = <T,>(contract: string, name: string, args: T, txN: number, block: bigint, logIndex: number) =>
      harness.makeEvent(contract, name, args, { tx: tx(txN), block, logIndex }) as ParsedEvent
    const sale = (tokenId: bigint, price: bigint, txN: number, block: bigint, logIndex: number) =>
      e("core", "Sale", { collection, tokenId, seller, buyer: bidder, price, marketplaceFeeAmount: 0n, royaltyAmount: 0n }, txN, block, logIndex)
    return [
      e("bids", "TokenBidPlaced", { collection, tokenId: 3n, bidder, price: WEI_TB, expiresAt: 0n }, 1, 1000n, 0),
      sale(3n, WEI_TB, 2, 1001n, 0),
      e("bids", "TokenBidAccepted", { collection, tokenId: 3n, bidder, seller, price: WEI_TB }, 2, 1001n, 1),
      e("bids", "CollectionBidPlaced", { collection, bidder, pricePerItem: WEI_CB, quantity: 3n, expiresAt: 0n }, 3, 1002n, 0),
      sale(2n, WEI_CB, 4, 1003n, 0),
      sale(4n, WEI_CB, 4, 1003n, 1),
      e("bids", "CollectionBidAccepted", { collection, bidder, seller, tokenIds: [2n, 4n], totalPrice: WEI_CB * 2n }, 4, 1003n, 2),
      // A cancel/replace on token 1, so a replayed cancel would hit the later bid if order were ignored.
      e("bids", "TokenBidPlaced", { collection, tokenId: 1n, bidder, price: 1n, expiresAt: 0n }, 5, 1004n, 0),
      e("bids", "TokenBidCancelled", { collection, tokenId: 1n, bidder }, 6, 1005n, 0),
      e("bids", "TokenBidPlaced", { collection, tokenId: 1n, bidder, price: 2n, expiresAt: 0n }, 7, 1006n, 0),
    ]
  }

  async function snapshot() {
    const sb = localClient()
    const [tb, cb, fills, act, col] = await Promise.all([
      sb.from("token_bids").select("*").eq("collection_address", collection).order("block_number"),
      sb.from("collection_bids").select("*").eq("collection_address", collection).order("block_number"),
      sb.from("collection_bid_fills").select("*").in("tx_hash", hashes).order("block_number"),
      sb.from("activity").select("*").in("tx_hash", hashes).order("tx_hash").order("log_index"),
      sb.from("collections").select("chain_id, total_volume::text, total_sales::text").eq("contract_address", collection).order("chain_id"),
    ])
    for (const r of [tb, cb, fills, act, col]) if (r.error) throw r.error
    return { token_bids: tb.data!, collection_bids: cb.data!, fills: fills.data!, activity: act.data!, collections: col.data! }
  }

  async function run(events: ParsedEvent[]) {
    for (const event of events) await harness.registry.dispatch(event)
  }

  it("#11/#14: a full and a partial replay leave every row identical", async () => {
    await run(range())
    const first = await snapshot()

    // The state is right, not only stable.
    expect(first.collection_bids.map((b) => [b.placed_quantity, b.quantity, b.is_active])).toEqual([[3, 1, true]])
    expect(first.fills.map((f) => f.token_count)).toEqual([2])
    expect(first.token_bids.map((b) => [b.token_id, b.price, b.is_active])).toEqual([
      ["3", Number(WEI_TB), false],
      ["1", 1, false],
      ["1", 2, true],
    ])
    expect(first.collections).toEqual([
      { chain_id: 99801, total_volume: "2.519135780246913578", total_sales: "3" },
      { chain_id: 11155111, total_volume: "0", total_sales: "0" },
    ])

    await run(range())
    expect(await snapshot()).toEqual(first)

    await run(range().filter((e) => e.blockNumber >= 1003n))
    expect(await snapshot()).toEqual(first)
  })

  it("#15: the same (collection, bidder) on another chain is untouched", async () => {
    const sepolia = new harness.BidsRepository(localClient(), 11155111)
    const at = new Date("2026-11-07T00:00:00Z")
    await sepolia.placeCollectionBid({ collectionAddress: collection, bidderWallet: bidder }, { blockNumber: 5n, logIndex: 0, txHash: tx(30) }, at, {
      price: "7",
      quantity: 9,
      expiresAt: null,
    })
    await run([harness.makeEvent("bids", "CollectionBidCancelled", { collection, bidder }, { tx: tx(31), block: 1010n, logIndex: 0 }) as ParsedEvent])

    const { data, error } = await localClient()
      .from("collection_bids")
      .select("chain_id, quantity, is_active")
      .eq("collection_address", collection)
      .order("chain_id")
    if (error) throw error
    expect(data).toEqual([
      { chain_id: 99801, quantity: 1, is_active: false },
      { chain_id: 11155111, quantity: 9, is_active: true },
    ])
  })
})
