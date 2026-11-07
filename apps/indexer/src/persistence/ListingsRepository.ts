import type { SupabaseClient } from "@supabase/supabase-js"
import { buildListingId, normalizeCollectionAddress, normalizeTokenId } from "@marketplace/shared"
import { env } from "../config/env"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// LISTINGS REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Repository for NFT listings.
 * Handles all database operations related to marketplace listings.
 */
export class ListingsRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Upsert a listing record.
   */
  async upsert(params: {
    collectionAddress: string
    tokenId: string
    sellerWallet: string
    price: number
    expiresAt: Date | null
    isActive: boolean
    txHash: string
    createdAt: Date
    updatedAt: Date
    status: string
    source: string
  }): Promise<void> {
    const collectionAddress = normalizeCollectionAddress(params.collectionAddress)
    const tokenId = normalizeTokenId(params.tokenId)
    const listingId = buildListingId(env.chainId, collectionAddress, tokenId)

    const { error } = await this.supabase.from("listings").upsert(
      {
        listing_id: listingId,
        chain_id: env.chainId,
        collection_address: collectionAddress,
        token_id: tokenId,
        seller_wallet: params.sellerWallet.toLowerCase(),
        // M-7: a (re)listing reuses the row of an earlier sale; clear the old buyer.
        buyer_wallet: null,
        price: params.price,
        expires_at: params.expiresAt,
        is_active: params.isActive,
        tx_hash: params.txHash.toLowerCase(),
        created_at: params.createdAt,
        updated_at: params.updatedAt,
        status: params.status,
        source: params.source,
      },
      {
        onConflict: "chain_id,collection_address,token_id",
        ignoreDuplicates: false,
      },
    )

    if (error) {
      logger.error({ error, listingId }, "❌ Failed to upsert listing")
      throw error
    }
  }

  /**
   * Update listing price.
   */
  async updatePrice(collectionAddress: string, tokenId: string, newPrice: number, updatedAt: Date): Promise<void> {
    const collection = normalizeCollectionAddress(collectionAddress)
    const token = normalizeTokenId(tokenId)
    const { error } = await this.supabase
      .from("listings")
      .update({
        price: newPrice,
        updated_at: updatedAt,
      })
      .eq("chain_id", env.chainId)
      .eq("collection_address", collection)
      .eq("token_id", token)
      .eq("is_active", true)

    if (error) {
      logger.error({ error, collectionAddress: collection, tokenId: token, newPrice }, "❌ Failed to update listing price")
      throw error
    }
  }

  /**
   * Deactivate a listing (cancel or sale).
   */
  async deactivate(collectionAddress: string, tokenId: string, updatedAt: Date, buyerWallet?: string): Promise<void> {
    const collection = normalizeCollectionAddress(collectionAddress)
    const token = normalizeTokenId(tokenId)
    const updateData: any = {
      is_active: false,
      updated_at: updatedAt,
    }

    if (buyerWallet) {
      updateData.buyer_wallet = buyerWallet.toLowerCase()
    }

    const { error } = await this.supabase
      .from("listings")
      .update(updateData)
      .eq("chain_id", env.chainId)
      .eq("collection_address", collection)
      .eq("token_id", token)

    if (error) {
      logger.error({ error, collectionAddress: collection, tokenId: token }, "❌ Failed to deactivate listing")
      // Don't throw - listing might not exist
    }
  }
}
