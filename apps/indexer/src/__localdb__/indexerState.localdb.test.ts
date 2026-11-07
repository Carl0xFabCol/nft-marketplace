// indexer_state after 20261028091500 (chain_id integer, last_block_hash), through
// the real IndexerStateRepository. Chain 11155111 so a restored 99801 cursor is
// never touched.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { HAS_LOCALDB, localClient } from "./localdb"

const CHAIN = 11155111

describe.runIf(HAS_LOCALDB)("indexer_state cursor + hash on a real database", () => {
  let saved: Record<string, unknown> | null = null

  beforeAll(async () => {
    const sb = localClient()
    saved = (await sb.from("indexer_state").select("*").eq("chain_id", CHAIN).maybeSingle()).data
    await sb.from("indexer_state").delete().eq("chain_id", CHAIN)
  })

  afterAll(async () => {
    const sb = localClient()
    await sb.from("indexer_state").delete().eq("chain_id", CHAIN)
    if (saved) await sb.from("indexer_state").insert(saved)
  })

  it("writes block and hash together, never rewinds, and rejects a non-canonical hash", async () => {
    const { IndexerStateRepository } = await import("../persistence/IndexerStateRepository")
    const repo = new IndexerStateRepository(localClient())
    await repo.setForDeployment(CHAIN, 100)
    expect(await repo.getState(CHAIN)).toMatchObject({ chain_id: CHAIN, last_block: 100, last_block_hash: null })

    const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}`
    await repo.updateLastBlock(CHAIN, 120, h(120).toUpperCase().replace("0X", "0x"))
    expect(await repo.getState(CHAIN)).toMatchObject({ last_block: 120, last_block_hash: h(120) })

    // Monotonic guard: a lower block (and its hash) is a silent no-op.
    await repo.updateLastBlock(CHAIN, 110, h(110))
    expect(await repo.getState(CHAIN)).toMatchObject({ last_block: 120, last_block_hash: h(120) })

    await expect(repo.updateLastBlock(CHAIN, 130, "0x1234")).rejects.toMatchObject({ code: "23514" })
    expect(typeof (await repo.getState(CHAIN))?.chain_id).toBe("number")
  })
})
