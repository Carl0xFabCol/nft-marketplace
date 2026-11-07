// Phase 3B task 0: verify, on a real local PostgREST, the Phase 3A assumption
// behind ActivityRepository.insert: an upsert with ignoreDuplicates (INSERT ...
// ON CONFLICT DO NOTHING RETURNING) returns ONLY the rows it actually inserted.
import { afterAll, describe, expect, it } from "vitest"
import { HAS_LOCALDB, localClient, testTxHash } from "./localdb"

describe.runIf(HAS_LOCALDB)("activity upsert ignoreDuplicates returns only inserted rows (local PostgREST)", () => {
  const tag = "task0"
  const hashes: string[] = []

  afterAll(async () => {
    if (hashes.length) await localClient().from("activity").delete().in("tx_hash", hashes)
  })

  it("ActivityRepository.insert: fresh → true, replay → false, one row", async () => {
    const { ActivityRepository } = await import("../persistence/ActivityRepository")
    const repo = new ActivityRepository(localClient())
    const tx = testTxHash(tag, 1)
    hashes.push(tx)
    const params = {
      event: "SALE",
      collectionAddress: "0x00000000000000000000000000000000000000aa",
      tokenId: "1",
      price: "1000000000000000000",
      txHash: tx,
      createdAt: new Date("2026-11-07T00:00:00Z"),
      logIndex: 3,
      sourceContract: "core",
    }
    expect(await repo.insert(params)).toBe(true)
    expect(await repo.insert(params)).toBe(false)
    const { count } = await localClient().from("activity").select("id", { count: "exact", head: true }).eq("tx_hash", tx)
    expect(count).toBe(1)
  })

  it("a mixed batch returns only the new row", async () => {
    const sb = localClient()
    const dup = testTxHash(tag, 2)
    const fresh = testTxHash(tag, 3)
    hashes.push(dup, fresh)
    const row = (tx: string) => ({ event: "SALE", chain_id: 99801, collection_address: "0xaa", tx_hash: tx, log_index: 0, created_at: new Date().toISOString() })
    const first = await sb.from("activity").upsert(row(dup), { onConflict: "tx_hash,log_index", ignoreDuplicates: true }).select("tx_hash")
    expect(first.error).toBeNull()
    expect(first.data).toHaveLength(1)
    const mixed = await sb.from("activity").upsert([row(dup), row(fresh)], { onConflict: "tx_hash,log_index", ignoreDuplicates: true }).select("tx_hash")
    expect(mixed.error).toBeNull()
    expect(mixed.data).toEqual([{ tx_hash: fresh }])
  })
})
