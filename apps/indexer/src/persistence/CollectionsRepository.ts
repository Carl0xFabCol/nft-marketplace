import type { SupabaseClient } from "@supabase/supabase-js"
import type { Address } from "viem"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTIONS REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Repository for NFT collections.
 * Handles all database operations related to collection management.
 */
export class CollectionsRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Upsert a collection record.
   */
  async upsert(params: {
    contractAddress: string
    chainId: number
    creatorWallet: string
    name: string
    symbol: string
    royaltyFee: number
    isVerified: boolean
    deployedAt: number
    indexerBlock: number
    createdAt: Date
    updatedAt: Date
  }): Promise<void> {
    const { error } = await this.supabase.from("collections").upsert(
      {
        contract_address: params.contractAddress.toLowerCase(),
        chain_id: params.chainId,
        creator_wallet: params.creatorWallet.toLowerCase(),
        name: params.name,
        symbol: params.symbol,
        royalty_fee: params.royaltyFee,
        is_verified: params.isVerified,
        deployed_at: params.deployedAt,
        indexer_block: params.indexerBlock,
        created_at: params.createdAt,
        updated_at: params.updatedAt,
      },
      { onConflict: "contract_address" },
    )

    if (error) {
      logger.error({ error, contractAddress: params.contractAddress }, "❌ Failed to upsert collection")
      throw error
    }
  }

  /**
   * Update collection verification status.
   */
  async updateVerificationStatus(contractAddress: string, isVerified: boolean, updatedAt: Date): Promise<void> {
    const { error } = await this.supabase
      .from("collections")
      .update({
        is_verified: isVerified,
        updated_at: updatedAt,
      })
      .eq("contract_address", contractAddress.toLowerCase())

    if (error) {
      logger.error({ error, contractAddress }, "❌ Failed to update collection verification")
      throw error
    }
  }

  /**
   * Update collection indexer block.
   */
  async updateIndexerBlock(contractAddress: string, indexerBlock: number): Promise<void> {
    const { error } = await this.supabase.from("collections").update({ indexer_block: indexerBlock }).eq("contract_address", contractAddress.toLowerCase())

    if (error) {
      logger.error({ error, contractAddress, indexerBlock }, "❌ Failed to update collection indexer block")
      throw error
    }
  }

  /**
   * Increment collection stats (volume and sales count).
   */
  async incrementStats(contractAddress: string, volumeInEth: number, salesCount: number): Promise<void> {
    const { error } = await this.supabase.rpc("increment_collection_stats", {
      p_collection_address: contractAddress.toLowerCase(),
      p_volume: volumeInEth,
      p_sales: salesCount,
    })

    if (error) {
      logger.error({ error, contractAddress, volumeInEth, salesCount }, "❌ Failed to increment collection stats")
      throw error
    }
  }

  /**
   * Get all registered collections, optionally scoped to a chain.
   * Scoping is important when multiple indexer instances (one per chain)
   * share the same database: otherwise each instance would try to index
   * collections that belong to a different chain.
   */
  async getAll(chainId?: number): Promise<any[]> {
    let query = this.supabase.from("collections").select("*")
    if (chainId !== undefined) {
      query = query.eq("chain_id", chainId)
    }

    const { data, error } = await query

    if (error) {
      logger.error({ error, chainId }, "❌ Failed to fetch collections")
      throw error
    }

    return data || []
  }
}
