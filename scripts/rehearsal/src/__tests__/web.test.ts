import { describe, expect, it } from "vitest"
import { CONFIRMATIONS } from "../indexer"
import { restartIndexerPastListing } from "../web"

describe("restartIndexerPastListing (23503 retry driver)", () => {
  it("starts the indexer, then mines CONFIRMATIONS blocks so the listing block leaves the confirmation window", async () => {
    // Phase 5 run: listing at head 339, cursor stuck at nextBlock 338 ("No
    // confirmed blocks to index yet") because automine produced no later block.
    const calls: string[] = []
    await restartIndexerPastListing({
      indexer: { start: () => void calls.push("start") },
      rpc: async (method, params) => {
        calls.push(`${method} ${JSON.stringify(params)}`)
        return null
      },
    })
    expect(calls).toEqual(["start", `anvil_mine ["0x${CONFIRMATIONS.toString(16)}"]`])
    expect(CONFIRMATIONS).toBeGreaterThan(0)
  })
})
