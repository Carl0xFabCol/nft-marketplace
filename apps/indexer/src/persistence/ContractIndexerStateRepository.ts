import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRACT INDEXER STATE REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Per-contract indexing progress tracking.
 * Each row tracks the last_block processed for a specific contract address.
 * Table: contract_indexer_state (PK: contract_address)
 */
export interface ContractIndexerState {
  contract_address: string
  chain_id: number
  last_block: number
  created_at?: string
  updated_at?: string
}

/**
 * Repository for per-contract indexer state.
 * Tracks the last processed block for each dynamically-registered collection contract.
 * This is separate from the global indexer_state which tracks overall progress for
 * static contracts (core, bids).
 */
export class ContractIndexerStateRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get the last indexed block for a specific contract address.
   * Returns null if no state exists yet (contract is new, start from deploy block).
   */
  async getContractState(contractAddress: string, chainId: number): Promise<ContractIndexerState | null> {
    const { data, error } = await this.supabase
      .from("contract_indexer_state")
      .select("*")
      .eq("contract_address", contractAddress.toLowerCase())
      .eq("chain_id", chainId)
      .single()

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned, which is fine for new contracts
      logger.error({ error, contractAddress, chainId }, "❌ Failed to fetch contract indexer state")
      throw error
    }

    return data
  }

  /**
   * Upsert the last indexed block for a contract.
   * Uses INSERT ... ON CONFLICT (contract_address, chain_id) DO UPDATE.
   */
  async upsertContractState(
    contractAddress: string,
    chainId: number,
    lastBlock: number,
  ): Promise<void> {
    const { error } = await this.supabase.from("contract_indexer_state").upsert(
      {
        contract_address: contractAddress.toLowerCase(),
        chain_id: chainId,
        last_block: lastBlock,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "contract_address,chain_id" },
    )

    if (error) {
      logger.error({ error, contractAddress, chainId, lastBlock }, "❌ Failed to upsert contract indexer state")
      throw error
    }
  }

  /**
   * Get all contract states for a given chain.
   * Used during startup to discover all contracts being indexed.
   */
  async getAllForChain(chainId: number): Promise<ContractIndexerState[]> {
    const { data, error } = await this.supabase.from("contract_indexer_state").select("*").eq("chain_id", chainId)

    if (error) {
      logger.error({ error, chainId }, "❌ Failed to fetch all contract indexer states")
      throw error
    }

    return data || []
  }
}
