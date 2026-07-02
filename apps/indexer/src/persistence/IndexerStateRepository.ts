import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXER STATE REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

export interface IndexerState {
  chain_id: number
  last_block: number
  created_at?: Date
  updated_at?: Date
}

/**
 * Repository for indexer state tracking.
 * Handles all database operations related to indexer progress.
 */
export class IndexerStateRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get indexer state for a specific chain.
   */
  async getState(chainId: number): Promise<IndexerState | null> {
    const { data, error } = await this.supabase.from("indexer_state").select("*").eq("chain_id", chainId).single()

    if (error) {
      logger.error({ error, chainId }, "❌ Failed to fetch indexer state")
      throw error
    }

    return data
  }

  /**
   * Update the last indexed block for a chain.
   */
  async updateLastBlock(chainId: number, lastBlock: number): Promise<void> {
    const { error } = await this.supabase.from("indexer_state").update({ last_block: lastBlock }).eq("chain_id", chainId)

    if (error) {
      logger.error({ error, chainId, lastBlock }, "❌ Failed to update indexer state")
      throw error
    }
  }
}
