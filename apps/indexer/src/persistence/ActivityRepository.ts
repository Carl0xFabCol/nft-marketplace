import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITY REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Repository for activity records.
 * Handles all database operations related to blockchain activity tracking.
 */
export class ActivityRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Insert a new activity record.
   */
  async insert(params: {
    event: string
    collectionAddress: string
    tokenId?: string
    from?: string
    to?: string
    price?: string
    quantity?: number
    txHash: string
    createdAt: Date
    logIndex: number
    sourceContract: string
  }): Promise<void> {
    const { error } = await this.supabase.from("activity").insert({
      event: params.event,
      collection_address: params.collectionAddress.toLowerCase(),
      token_id: params.tokenId,
      from: params.from?.toLowerCase(),
      to: params.to?.toLowerCase(),
      price: params.price,
      quantity: params.quantity,
      tx_hash: params.txHash.toLowerCase(),
      created_at: params.createdAt,
      log_index: params.logIndex,
      source_contract: params.sourceContract,
    })

    if (error) {
      logger.error({ error, params }, "❌ Failed to insert activity")
      throw error
    }
  }
}
