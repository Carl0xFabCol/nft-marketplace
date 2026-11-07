// prepare-deployment against a real local database (needs 20261028091000 and
// 091500), through the real repositories. Uses chain 11155111 so it never
// collides with a 99801 cursor of a restored real-data backup.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { HAS_LOCALDB, localClient, testAddress } from "./localdb"

const CHAIN = 11155111

describe.runIf(HAS_LOCALDB)("prepare-deployment on a real database", () => {
  const collection = testAddress("prep")
  let saved: Record<string, unknown> | null = null

  async function deps() {
    const { checkRecordStatic } = await import("@marketplace/contracts/deployment-records")
    const { IndexerStateRepository } = await import("../persistence/IndexerStateRepository")
    const { ContractIndexerStateRepository } = await import("../persistence/ContractIndexerStateRepository")
    const { CollectionsRepository } = await import("../persistence/CollectionsRepository")
    const sb = localClient()
    return {
      chainId: CHAIN,
      readRecord: (network: string) => ({
        fileName: `${network}.json`,
        data: {
          stage: "verified",
          configured: true,
          chainId: CHAIN,
          network: "sepolia",
          core: "0x1111111111111111111111111111111111111111",
          bids: "0x2222222222222222222222222222222222222222",
          marketplace: "0x3333333333333333333333333333333333333333",
        },
      }),
      checkRecord: checkRecordStatic,
      indexerState: new IndexerStateRepository(sb),
      contractState: new ContractIndexerStateRepository(sb),
      collections: new CollectionsRepository(sb),
      log: () => {},
    }
  }

  beforeAll(async () => {
    const sb = localClient()
    const { data } = await sb.from("indexer_state").select("*").eq("chain_id", CHAIN).maybeSingle()
    saved = data
    await sb.from("indexer_state").delete().eq("chain_id", CHAIN)
    const c = await sb.from("collections").insert({ chain_id: CHAIN, contract_address: collection, indexer_block: 700 })
    if (c.error) throw c.error
  })

  afterAll(async () => {
    const sb = localClient()
    await sb.from("contract_indexer_state").delete().eq("contract_address", collection)
    await sb.from("collections").delete().eq("contract_address", collection)
    await sb.from("indexer_state").delete().eq("chain_id", CHAIN)
    if (saved) await sb.from("indexer_state").insert(saved)
  })

  async function cursor() {
    const { data, error } = await localClient().from("indexer_state").select("last_block, last_block_hash").eq("chain_id", CHAIN).single()
    if (error) throw error
    return data
  }

  it("creates, refuses to lower, lowers with --force, and seeds the collection cursor once", async () => {
    const { prepareDeployment } = await import("../deployment/prepareDeployment")
    const d = await deps()
    const run = (deployBlock: number, force = false) => prepareDeployment({ network: "sepolia", deployBlock, force, dryRun: false }, d)

    const first = await run(1000)
    expect(first.seededCollections).toEqual([collection])
    expect(await cursor()).toEqual({ last_block: 999, last_block_hash: null })

    // The indexer checkpoints further and stores a hash.
    await localClient().from("indexer_state").update({ last_block: 5000, last_block_hash: `0x${"ab".repeat(32)}` }).eq("chain_id", CHAIN)

    await expect(run(1000)).rejects.toThrow(/refusing to lower it to 999 without --force/)
    expect(await cursor()).toEqual({ last_block: 5000, last_block_hash: `0x${"ab".repeat(32)}` })

    const forced = await run(1000, true)
    expect(forced.seededCollections).toEqual([]) // already seeded, untouched
    expect(await cursor()).toEqual({ last_block: 999, last_block_hash: null })

    const { data } = await localClient().from("contract_indexer_state").select("chain_id, last_block").eq("contract_address", collection)
    expect(data).toEqual([{ chain_id: CHAIN, last_block: 699 }])
  })
})
