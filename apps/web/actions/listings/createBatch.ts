// actions/listings/createBatch.ts
"use server"

import { Address, isAddress } from "viem"
import { requireWalletMatch } from "@/lib/supabase/auth"
import { createSupabaseAdmin } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { SUPPORTED_CHAIN_IDS } from "@/lib/chains"
import { normalizeTokenId } from "@marketplace/shared"
import { isNftNotIndexedError } from "@/lib/optimisticListing"

export interface BatchListingData {
  txHash: `0x${string}`
  collections: Address[]
  tokenIds: string[]
  prices: string[]
  seller: Address
  chainId: number
  expiresAts: string[]
}

/**
 * `{ success: false, reason: "not_indexed" }`: the optimistic insert hit
 * listings_nft_fk (23503) because the indexer has not written the `nfts` row
 * yet (fresh mint / transfer). The on-chain listing is fine; the caller retries
 * (the RPC is idempotent) and the indexer writes the listing from ListingCreated
 * regardless. Returned, not thrown: Next.js redacts thrown server-action
 * messages in production builds.
 */
export type SaveBatchListingResult = { success: true } | { success: false; reason: "not_indexed" }

const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/
const UINT_PATTERN = /^\d{1,78}$/
const TIMESTAMP_PATTERN = /^\d{1,10}$/
const MAX_BATCH_SIZE = 100

export async function saveBatchListingToDB(data: BatchListingData): Promise<SaveBatchListingResult> {
  try {
    if (!data || typeof data !== "object") throw new Error("Invalid listing data")

    const { txHash, collections, tokenIds, prices, seller, chainId, expiresAts } = data

    if (typeof txHash !== "string" || !HASH_PATTERN.test(txHash)) throw new Error("Invalid transaction hash")
    if (typeof seller !== "string" || !isAddress(seller)) throw new Error("Invalid seller address")
    if (!Number.isInteger(chainId) || !SUPPORTED_CHAIN_IDS.includes(chainId)) throw new Error("Unsupported chain")
    if (!Array.isArray(tokenIds) || tokenIds.length === 0 || tokenIds.length > MAX_BATCH_SIZE) throw new Error("Invalid batch size")
    if (!Array.isArray(collections) || collections.length !== tokenIds.length) throw new Error("Invalid collection list")
    if (!Array.isArray(prices) || prices.length !== tokenIds.length) throw new Error("Invalid price list")
    if (!Array.isArray(expiresAts) || expiresAts.length !== tokenIds.length) throw new Error("Invalid expiration list")

    const normalizedTokenIds: string[] = []
    const seenListings = new Set<string>()

    for (let index = 0; index < tokenIds.length; index++) {
      if (typeof collections[index] !== "string" || !isAddress(collections[index])) throw new Error("Invalid collection address")
      if (typeof tokenIds[index] !== "string") throw new Error("Invalid token id")
      if (typeof prices[index] !== "string" || !UINT_PATTERN.test(prices[index]) || BigInt(prices[index]) <= BigInt(0)) throw new Error("Invalid price")
      if (typeof expiresAts[index] !== "string" || !TIMESTAMP_PATTERN.test(expiresAts[index])) throw new Error("Invalid expiration")

      const tokenId = normalizeTokenId(tokenIds[index])
      const listingKey = `${chainId}:${collections[index].toLowerCase()}:${tokenId}`
      if (seenListings.has(listingKey)) throw new Error("Duplicate listing in batch")
      seenListings.add(listingKey)
      normalizedTokenIds.push(tokenId)
    }

    // The caller must own the wallet that appears as seller on the rows.
    await requireWalletMatch(seller)

    const hash = txHash.toLowerCase()
    const sellerWallet = seller.toLowerCase()
    const rows = normalizedTokenIds.map((tokenId, index) => {
      const rawExpire = expiresAts[index]
      const expiresAt = Number(rawExpire) > 0 ? new Date(Number(rawExpire) * 1000).toISOString() : null

      return {
        collection_address: collections[index].toLowerCase(),
        token_id: tokenId,
        price: prices[index],
        expires_at: expiresAt,
      }
    })

    const admin = createSupabaseAdmin()
    const { data: savedCount, error: dbError } = await admin.rpc("sec01_save_listing_batch", {
      p_seller: sellerWallet,
      p_tx_hash: hash,
      p_chain_id: chainId,
      p_rows: rows,
    })

    if (dbError) {
      if (isNftNotIndexedError(dbError)) {
        console.warn("Optimistic listing waits for the indexer (listings_nft_fk):", dbError.details)
        return { success: false, reason: "not_indexed" }
      }

      console.error("Failed to save optimistic listings:", dbError)

      // Only surface the database's ownership conflict, not arbitrary DB text.
      if (dbError.code === "42501" && dbError.message.startsWith("Forbidden")) {
        throw new Error(dbError.message)
      }

      throw new Error("Failed to save listings")
    }

    if (savedCount !== rows.length) {
      console.error("Listing batch saved an unexpected row count:", savedCount, rows.length)
      throw new Error("Failed to save listings")
    }

    revalidatePath(`/user/${seller}`)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : ""

    // Auth and validation errors are safe to surface; raw DB errors are not.
    if (message === "Unauthorized" || message.startsWith("Forbidden") || message.startsWith("Invalid") || message.startsWith("Unsupported") || message.startsWith("Duplicate")) {
      throw err
    }

    console.error("saveBatchListingToDB error:", err)
    throw new Error("Failed to save listings")
  }
}
