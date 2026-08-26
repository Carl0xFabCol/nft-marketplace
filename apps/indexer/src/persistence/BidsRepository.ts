import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// BIDS REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Repository for collection and token bids.
 * Handles all database operations related to marketplace bidding.
 */
export class BidsRepository {
  constructor(private supabase: SupabaseClient) {}

  // ───────────────────────────────────────────────────────────────────────────
  // COLLECTION BIDS
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Cancel all active collection bids for a bidder on a collection.
   */
  async cancelActiveCollectionBids(collectionAddress: string, bidderWallet: string, updatedAt: Date): Promise<void> {
    const { error } = await this.supabase
      .from("collection_bids")
      .update({
        is_active: false,
        updated_at: updatedAt,
      })
      .eq("collection_address", collectionAddress.toLowerCase())
      .eq("bidder_wallet", bidderWallet.toLowerCase())
      .eq("is_active", true)

    if (error) {
      logger.error(
        {
          error,
          collectionAddress,
          bidderWallet,
        },
        "❌ Failed to cancel previous collection bid",
      )

      throw error
    }
  }

  /**
   * Insert a new collection bid.
   */
  async insertCollectionBid(params: { collectionAddress: string; bidderWallet: string; price: number; quantity: number; expiresAt: Date | null; isActive: boolean; createdAt: Date }): Promise<void> {
    const { error } = await this.supabase.from("collection_bids").insert({
      collection_address: params.collectionAddress.toLowerCase(),
      bidder_wallet: params.bidderWallet.toLowerCase(),
      price: params.price,
      quantity: params.quantity,
      expires_at: params.expiresAt,
      is_active: params.isActive,
      created_at: params.createdAt,
    })

    if (error) {
      logger.error({ error, params }, "❌ Failed to insert collection bid")
      throw error
    }
  }

  /**
   * Get an active collection bid.
   */
  async getActiveCollectionBid(collectionAddress: string, bidderWallet: string): Promise<{ quantity: number } | null> {
    const { data, error } = await this.supabase
      .from("collection_bids")
      .select("quantity")
      .eq("collection_address", collectionAddress.toLowerCase())
      .eq("bidder_wallet", bidderWallet.toLowerCase())
      .eq("is_active", true)
      .single()

    if (error) {
      logger.debug({ error, collectionAddress, bidderWallet }, "⚠️  No active collection bid found")
      return null
    }

    return data
  }

  /**
   * Deactivate a collection bid.
   */
  async deactivateCollectionBid(collectionAddress: string, bidderWallet: string, updatedAt: Date): Promise<void> {
    const { error } = await this.supabase
      .from("collection_bids")
      .update({
        is_active: false,
        updated_at: updatedAt,
      })
      .eq("collection_address", collectionAddress.toLowerCase())
      .eq("bidder_wallet", bidderWallet.toLowerCase())

    if (error) {
      logger.error({ error, collectionAddress, bidderWallet }, "❌ Failed to deactivate collection bid")
      throw error
    }
  }

  /**
   * Update collection bid quantity (partial fill).
   */
  async updateCollectionBidQuantity(collectionAddress: string, bidderWallet: string, newQuantity: number, updatedAt: Date): Promise<void> {
    const { error } = await this.supabase
      .from("collection_bids")
      .update({
        quantity: newQuantity,
        updated_at: updatedAt,
      })
      .eq("collection_address", collectionAddress.toLowerCase())
      .eq("bidder_wallet", bidderWallet.toLowerCase())

    if (error) {
      logger.error({ error, collectionAddress, bidderWallet, newQuantity }, "❌ Failed to update collection bid quantity")
      throw error
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TOKEN BIDS
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Cancel all active token bids for a bidder on a specific token.
   */
  async cancelActiveTokenBids(collectionAddress: string, tokenId: string, bidderWallet: string, updatedAt: Date): Promise<void> {
    const { error } = await this.supabase
      .from("token_bids")
      .update({
        is_active: false,
        updated_at: updatedAt,
      })
      .eq("collection_address", collectionAddress.toLowerCase())
      .eq("token_id", tokenId)
      .eq("bidder_wallet", bidderWallet.toLowerCase())
      .eq("is_active", true)

    if (error) {
      logger.error({ error, collectionAddress, tokenId, bidderWallet }, "❌ Failed to cancel previous token bid")

      throw error
    }
  }

  /**
   * Insert a new token bid.
   */
  async insertTokenBid(params: { collectionAddress: string; tokenId: string; bidderWallet: string; price: number; expiresAt: Date | null; isActive: boolean; createdAt: Date }): Promise<void> {
    const { error } = await this.supabase.from("token_bids").insert({
      collection_address: params.collectionAddress.toLowerCase(),
      token_id: params.tokenId,
      bidder_wallet: params.bidderWallet.toLowerCase(),
      price: params.price,
      expires_at: params.expiresAt,
      is_active: params.isActive,
      created_at: params.createdAt,
    })

    if (error) {
      logger.error({ error, params }, "❌ Failed to insert token bid")
      throw error
    }
  }

  /**
   * Deactivate a token bid.
   */
  async deactivateTokenBid(collectionAddress: string, tokenId: string, bidderWallet: string, updatedAt: Date): Promise<void> {
    const { error } = await this.supabase
      .from("token_bids")
      .update({
        is_active: false,
        updated_at: updatedAt,
      })
      .eq("collection_address", collectionAddress.toLowerCase())
      .eq("token_id", tokenId)
      .eq("bidder_wallet", bidderWallet.toLowerCase())

    if (error) {
      logger.error({ error, collectionAddress, tokenId, bidderWallet }, "❌ Failed to deactivate token bid")
      // Don't throw - bid might not exist
    }
  }
}
