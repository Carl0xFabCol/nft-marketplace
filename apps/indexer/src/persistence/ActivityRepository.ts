import type { SupabaseClient } from "@supabase/supabase-js"
import { env } from "../config/env"
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
   * Insert a new activity record. Idempotent on (tx_hash, log_index).
   *
   * Returns true when this call inserted the row and false when it already
   * existed (a replayed event). PostgREST with ignoreDuplicates is
   * INSERT ... ON CONFLICT DO NOTHING RETURNING, which returns only the rows
   * actually inserted. SaleHandler uses this to apply additive stats at most
   * once per on-chain log (IDX-1 / replay safety).
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
  }): Promise<boolean> {
    const { data, error } = await this.supabase.from("activity").upsert(
      {
        event: params.event,
        chain_id: env.chainId,
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
      },
      { onConflict: "tx_hash,log_index", ignoreDuplicates: true },
    ).select("id")

    if (error) {
      logger.error({ error, params }, "❌ Failed to insert activity")
      throw error
    }

    return Array.isArray(data) && data.length > 0
  }

  /**
   * Delete the activity row of one on-chain log. Used only as a compensating
   * action when a write that must accompany a fresh activity row fails, so the
   * retry sees the event as new again.
   */
  async deleteByTxLog(txHash: string, logIndex: number): Promise<void> {
    const { error } = await this.supabase.from("activity").delete().eq("tx_hash", txHash.toLowerCase()).eq("log_index", logIndex)

    if (error) {
      logger.error({ error, txHash, logIndex }, "❌ Failed to delete activity (compensation)")
      throw error
    }
  }
}
