// actions/listings/createBatch.ts
"use server"

import { Address, isAddress } from "viem"
import { requireWalletMatch } from "@/lib/supabase/auth"
import { revalidatePath } from "next/cache"
import { SUPPORTED_CHAIN_IDS } from "@/lib/chains"

export interface BatchListingData {
  txHash: `0x${string}`
  collections: Address[]
  tokenIds: string[]
  prices: string[]
  seller: Address
  chainId: number
  expiresAts: string[]
}

const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/
const UINT_PATTERN = /^\d{1,78}$/
const TIMESTAMP_PATTERN = /^\d{1,10}$/
const MAX_BATCH_SIZE = 100

export async function saveBatchListingToDB(data: BatchListingData) {
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

    for (let index = 0; index < tokenIds.length; index++) {
      if (typeof collections[index] !== "string" || !isAddress(collections[index])) throw new Error("Invalid collection address")
      if (typeof tokenIds[index] !== "string" || !UINT_PATTERN.test(tokenIds[index])) throw new Error("Invalid token id")
      if (typeof prices[index] !== "string" || !UINT_PATTERN.test(prices[index]) || BigInt(prices[index]) <= BigInt(0)) throw new Error("Invalid price")
      if (typeof expiresAts[index] !== "string" || !TIMESTAMP_PATTERN.test(expiresAts[index])) throw new Error("Invalid expiration")
    }

    // The caller must own the wallet that appears as seller on the rows.
    const supabase = await requireWalletMatch(seller)

    const rows = tokenIds.map((tokenId, index) => {
      const rawExpire = expiresAts[index]
      const expiresAt = Number(rawExpire) > 0 ? new Date(Number(rawExpire) * 1000).toISOString() : null

      return {
        tx_hash: txHash,
        collection_address: collections[index].toLowerCase(),
        listing_id: `${collections[index].toLowerCase()}-${tokenId}`,
        token_id: tokenId,
        seller_wallet: seller.toLowerCase(),
        price: prices[index],
        chain_id: chainId,
        is_active: true,
        status: "pending",
        source: "optimistic",
        expires_at: expiresAt,
      }
    })

    const { error: dbError } = await supabase.from("listings").upsert(rows, {
      onConflict: "listing_id",
    })

    if (dbError) {
      console.error("Failed to upsert optimistic listings:", dbError)
      throw new Error("Failed to save listings")
    }

    revalidatePath(`/user/${seller}`)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : ""

    // Auth and validation errors are safe to surface; raw DB errors are not.
    if (message === "Unauthorized" || message.startsWith("Forbidden") || message.startsWith("Invalid") || message.startsWith("Unsupported")) {
      throw err
    }

    console.error("saveBatchListingToDB error:", err)
    throw new Error("Failed to save listings")
  }
}
