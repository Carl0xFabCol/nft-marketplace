// actions/listings/createBatch.ts
"use server"

import { Address } from "viem"
import { requireWalletMatch } from "@/lib/supabase/auth"
import { revalidatePath } from "next/cache"

export interface BatchListingData {
  txHash: `0x${string}`
  collections: Address[]
  tokenIds: string[]
  prices: string[]
  seller: Address
  chainId: number
  expiresAts: string[]
}

export async function saveBatchListingToDB(data: BatchListingData) {
  try {
    // The caller must own the wallet that appears as seller on the rows.
    const supabase = await requireWalletMatch(data.seller)

    const rows = data.tokenIds.map((tokenId, index) => {
      const rawExpire = data.expiresAts?.[index]
      const expiresAt = rawExpire && Number(rawExpire) > 0 ? new Date(Number(rawExpire) * 1000).toISOString() : null

      return {
        tx_hash: data.txHash,
        collection_address: data.collections[index].toLowerCase(),
        listing_id: `${data.collections[index].toLowerCase()}-${tokenId}`,
        token_id: tokenId,
        seller_wallet: data.seller.toLowerCase(),
        price: data.prices[index],
        chain_id: data.chainId,
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
      throw new Error(`Database error: ${dbError.message} (${dbError.code})`)
    }

    revalidatePath(`/user/${data.seller}`)
    return { success: true }
  } catch (err: any) {
    throw new Error(err.message || "Internal Server Error")
  }
}
