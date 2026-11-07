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
   * actually inserted (verified on a local PostgREST, Phase 3B task 0).
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
   * Record a Sale: the SALE activity row and the collection stats, in one
   * transaction, exactly once per on-chain log (RPC indexer_record_sale,
   * migration 20261028091200).
   *
   * The price is exact wei as a decimal string. The RPC adds wei * 1e-18 to
   * total_volume and 1 to total_sales of (chain_id, collection) only when the
   * activity row is new. Returns true for a fresh Sale and false for a replay.
   * Any error rolls back both writes, so a retry counts the Sale once.
   */
  async recordSale(params: {
    collectionAddress: string
    tokenId: string
    from: string
    to: string
    priceWei: string
    txHash: string
    createdAt: Date
    logIndex: number
    sourceContract: string
  }): Promise<boolean> {
    const { data, error } = await this.supabase.rpc("indexer_record_sale", {
      p_chain_id: env.chainId,
      p_collection_address: params.collectionAddress.toLowerCase(),
      p_token_id: params.tokenId,
      p_from: params.from.toLowerCase(),
      p_to: params.to.toLowerCase(),
      p_price_wei: params.priceWei,
      p_tx_hash: params.txHash.toLowerCase(),
      p_log_index: params.logIndex,
      p_created_at: params.createdAt.toISOString(),
      p_source_contract: params.sourceContract,
    })

    if (error) {
      logger.error({ error, params }, "❌ Failed to record sale")
      throw error
    }

    return data === true
  }

}
