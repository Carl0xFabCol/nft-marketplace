// Phase 3B task 1: indexer_record_sale (migration 20261028091200) on a real
// local database, through the real ActivityRepository.recordSale.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { HAS_LOCALDB, localClient, testAddress, testTxHash } from "./localdb"

describe.runIf(HAS_LOCALDB)("indexer_record_sale: atomic, idempotent, chain-scoped sale stats", () => {
  const collection = testAddress("sale")
  const hashes: string[] = []

  beforeAll(async () => {
    const { error } = await localClient()
      .from("collections")
      .insert([
        { chain_id: 99801, contract_address: collection, total_volume: 0, total_sales: 0 },
        { chain_id: 11155111, contract_address: collection, total_volume: 0, total_sales: 0 },
      ])
    if (error) throw error
  })

  afterAll(async () => {
    const sb = localClient()
    if (hashes.length) await sb.from("activity").delete().in("tx_hash", hashes)
    await sb.from("collections").delete().eq("contract_address", collection)
  })

  async function stats(chainId: number) {
    const { data, error } = await localClient()
      .from("collections")
      .select("total_volume::text, total_sales::text")
      .eq("chain_id", chainId)
      .eq("contract_address", collection)
      .single()
    if (error) throw error
    return data
  }

  it("counts a Sale once, with exact wei, only on its own chain", async () => {
    const { ActivityRepository } = await import("../persistence/ActivityRepository")
    const repo = new ActivityRepository(localClient())
    const tx = testTxHash("sale", 1)
    hashes.push(tx)
    const sale = {
      collectionAddress: collection.toUpperCase().replace("0X", "0x"),
      tokenId: "7",
      from: "0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294",
      to: "0x373cdd612de9857dea8ca360efc302405dd82860",
      priceWei: "1234567890123456789",
      txHash: tx,
      createdAt: new Date("2026-11-07T00:00:00Z"),
      logIndex: 2,
      sourceContract: "core",
    }

    expect(await repo.recordSale(sale)).toBe(true)
    expect(await repo.recordSale(sale)).toBe(false)

    expect(await stats(99801)).toEqual({ total_volume: "1.234567890123456789", total_sales: "1" })
    expect(await stats(11155111)).toEqual({ total_volume: "0", total_sales: "0" })

    const { data } = await localClient().from("activity").select("event, chain_id, price, collection_address").eq("tx_hash", tx)
    expect(data).toEqual([{ event: "SALE", chain_id: 99801, price: "1234567890123456789", collection_address: collection }])
  })

  it("rejects a non-decimal price and writes nothing", async () => {
    const tx = testTxHash("sale", 2)
    hashes.push(tx)
    const { error } = await localClient().rpc("indexer_record_sale", {
      p_chain_id: 99801,
      p_collection_address: collection,
      p_token_id: "1",
      p_from: "0x0",
      p_to: "0x0",
      p_price_wei: "1e18",
      p_tx_hash: tx,
      p_log_index: 0,
      p_created_at: new Date().toISOString(),
      p_source_contract: "core",
    })
    expect(error?.code).toBe("22023")
    const { count } = await localClient().from("activity").select("id", { count: "exact", head: true }).eq("tx_hash", tx)
    expect(count).toBe(0)
  })
})
