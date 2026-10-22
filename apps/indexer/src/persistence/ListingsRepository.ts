import type { SupabaseClient } from "@supabase/supabase-js"
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
    listingId: string
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
    const { error } = await this.supabase.from("listings").upsert(
      {
        listing_id: params.listingId,
        chain_id: env.chainId,
        collection_address: params.collectionAddress.toLowerCase(),
        token_id: params.tokenId,
        seller_wallet: params.sellerWallet.toLowerCase(),
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
        onConflict: "listing_id",
        ignoreDuplicates: false,
      },
    )

    if (error) {
      logger.error({ error, listingId: params.listingId }, "❌ Failed to upsert listing")
      throw error
    }
  }

  /**
   * Update listing price.
   */
  async updatePrice(listingId: string, newPrice: number, updatedAt: Date): Promise<void> {
    const { error } = await this.supabase
      .from("listings")
      .update({
        price: newPrice,
        updated_at: updatedAt,
      })
      .eq("listing_id", listingId)
      .eq("is_active", true)

    if (error) {
      logger.error({ error, listingId, newPrice }, "❌ Failed to update listing price")
      throw error
    }
  }

  /**
   * Deactivate a listing (cancel or sale).
   */
  async deactivate(listingId: string, updatedAt: Date, buyerWallet?: string): Promise<void> {
    const updateData: any = {
      is_active: false,
      updated_at: updatedAt,
    }

    if (buyerWallet) {
      updateData.buyer_wallet = buyerWallet.toLowerCase()
    }

    const { error } = await this.supabase.from("listings").update(updateData).eq("listing_id", listingId)

    if (error) {
      logger.error({ error, listingId }, "❌ Failed to deactivate listing")
      // Don't throw - listing might not exist
    }
  }
}
