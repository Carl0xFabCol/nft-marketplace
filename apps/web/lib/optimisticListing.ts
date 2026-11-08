// lib/optimisticListing.ts
// Retry of the optimistic listing insert while the indexer has not written the
// NFT row yet (listings_nft_fk, 23503 → `not_indexed`). Pure: the save call and
// the sleep are injected so the policy is unit-tested without timers.

import type { SaveBatchListingResult } from "@/actions/listings/createBatch"

/** PostgREST error for the optimistic insert racing the indexer (listings → nfts FK, 23503). */
export function isNftNotIndexedError(error: { code?: string; message?: string; details?: string | null } | null | undefined): boolean {
  if (!error || error.code !== "23503") return false
  return `${error.message ?? ""} ${error.details ?? ""}`.includes("listings_nft_fk")
}

/** ~45 s in total; the indexer's confirmation lag is 12 blocks by default. */
export const NOT_INDEXED_RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 24_000] as const

export type OptimisticRetryOutcome = "saved" | "still_not_indexed" | "failed"

export async function retryOptimisticListing(
  save: () => Promise<SaveBatchListingResult>,
  opts: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<OptimisticRetryOutcome> {
  const delays = opts.delaysMs ?? NOT_INDEXED_RETRY_DELAYS_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (const ms of delays) {
    await sleep(ms)
    try {
      const result = await save()
      if (result.success) return "saved"
    } catch (error) {
      console.error("Optimistic listing retry failed:", error)
      return "failed"
    }
  }
  return "still_not_indexed"
}

export const NOT_INDEXED_MESSAGE = "Listed on-chain. Waiting for the indexer to pick up this NFT…"
export const NOT_INDEXED_FINAL_MESSAGE = "Listed on-chain. It will appear automatically once indexed."
