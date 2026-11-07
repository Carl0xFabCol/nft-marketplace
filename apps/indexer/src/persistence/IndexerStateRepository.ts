import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXER STATE REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

export interface IndexerState {
  chain_id: number
  last_block: number
  /** Hash of last_block when it was checkpointed (IDX-3 reorg detection); NULL when unknown. */
  last_block_hash?: string | null
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
   * Like getState, but returns null instead of throwing when the chain has no row.
   */
  async findState(chainId: number): Promise<IndexerState | null> {
    const { data, error } = await this.supabase.from("indexer_state").select("*").eq("chain_id", chainId).maybeSingle()

    if (error) {
      logger.error({ error, chainId }, "❌ Failed to fetch indexer state")
      throw error
    }

    return data
  }

  /**
   * prepare-deployment only: set the cursor to an exact block (may lower it,
   * the caller enforces --force) and forget the stored hash. Creates the row
   * if the chain has none (UNIQUE (chain_id), migration 20261028091000).
   */
  async setForDeployment(chainId: number, lastBlock: number): Promise<void> {
    const { error } = await this.supabase
      .from("indexer_state")
      .upsert({ chain_id: chainId, last_block: lastBlock, last_block_hash: null }, { onConflict: "chain_id" })

    if (error) {
      logger.error({ error, chainId, lastBlock }, "❌ Failed to set indexer state for deployment")
      throw error
    }
  }

  /**
   * Move the last indexed block for a chain forward.
   *
   * IDX-3: the UPDATE only matches while the stored value is lower (or NULL),
   * so a stale or concurrent writer can never move the cursor backwards. A
   * non-advancing call is a silent no-op. The hash of `lastBlock` is written
   * in the same UPDATE (migration 20261028091500), so the stored pair is
   * always consistent.
   */
  async updateLastBlock(chainId: number, lastBlock: number, lastBlockHash: string): Promise<void> {
    const { error } = await this.supabase
      .from("indexer_state")
      .update({ last_block: lastBlock, last_block_hash: lastBlockHash.toLowerCase() })
      .eq("chain_id", chainId)
      .or(`last_block.is.null,last_block.lt.${lastBlock}`)

    if (error) {
      logger.error({ error, chainId, lastBlock }, "❌ Failed to update indexer state")
      throw error
    }
  }
}
