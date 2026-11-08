import { describe, expect, it, vi } from "vitest"
import { NOT_INDEXED_RETRY_DELAYS_MS, isNftNotIndexedError, retryOptimisticListing } from "./optimisticListing"
import type { SaveBatchListingResult } from "@/actions/listings/createBatch"

const notIndexed: SaveBatchListingResult = { success: false, reason: "not_indexed" }
const saved: SaveBatchListingResult = { success: true }

describe("isNftNotIndexedError", () => {
  it("matches only 23503 on listings_nft_fk (message or details)", () => {
    expect(isNftNotIndexedError({ code: "23503", message: 'violates foreign key constraint "listings_nft_fk"' })).toBe(true)
    expect(isNftNotIndexedError({ code: "23503", message: "fk violation", details: "listings_nft_fk" })).toBe(true)
    expect(isNftNotIndexedError({ code: "23503", message: 'violates foreign key constraint "nfts_collection_fk"' })).toBe(false)
    expect(isNftNotIndexedError({ code: "23505", message: "listings_nft_fk" })).toBe(false)
    expect(isNftNotIndexedError(null)).toBe(false)
  })
})

describe("retryOptimisticListing", () => {
  const sleep = vi.fn(async (ms: number) => void ms)

  it("retries with backoff until the indexer has written the NFT", async () => {
    const save = vi.fn<() => Promise<SaveBatchListingResult>>().mockResolvedValueOnce(notIndexed).mockResolvedValueOnce(saved)
    sleep.mockClear()
    await expect(retryOptimisticListing(save, { sleep })).resolves.toBe("saved")
    expect(save).toHaveBeenCalledTimes(2)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3000, 6000])
  })

  it("gives up after the last delay without reporting a failure", async () => {
    const save = vi.fn(async () => notIndexed)
    sleep.mockClear()
    await expect(retryOptimisticListing(save, { sleep })).resolves.toBe("still_not_indexed")
    expect(save).toHaveBeenCalledTimes(NOT_INDEXED_RETRY_DELAYS_MS.length)
  })

  it("stops on a real error", async () => {
    const save = vi.fn(async (): Promise<SaveBatchListingResult> => {
      throw new Error("Failed to save listings")
    })
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(retryOptimisticListing(save, { sleep })).resolves.toBe("failed")
    expect(save).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })
})
