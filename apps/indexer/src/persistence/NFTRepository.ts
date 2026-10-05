import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "../utils/logger"
import { env } from "../config/env"
// ═══════════════════════════════════════════════════════════════════════════════
// NFT REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Repository for NFT records.
 * Handles all database operations related to individual NFTs.
 */
export class NFTRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Upsert an NFT record with metadata.
   */
  async upsert(params: {
    collectionAddress: string
    tokenId: string
    ownerWallet: string
    lastSynced: Date
    chainId: number
    tokenUri: string | null
    imageUrl: string | null
    metadata: Record<string, unknown> | null
  }): Promise<void> {
    const { error } = await this.supabase.from("nfts").upsert(
      {
        collection_address: params.collectionAddress.toLowerCase(),
        token_id: params.tokenId,
        owner_wallet: params.ownerWallet.toLowerCase(),
        last_synced: params.lastSynced,
        chain_id: params.chainId,
        token_uri: params.tokenUri,
        image_url: params.imageUrl,
        metadata: params.metadata,
      },
      { onConflict: "collection_address,token_id,chain_id" },
    )

    if (error) {
      logger.error({ error, collectionAddress: params.collectionAddress, tokenId: params.tokenId }, "❌ Failed to upsert NFT")
      throw error
    }
  }

  async updateOwner(collectionAddress: string, tokenId: string, ownerWallet: string, lastSynced: Date): Promise<void> {
    const { error } = await this.supabase
      .from("nfts")
      .update({
        owner_wallet: ownerWallet.toLowerCase(),
        last_synced: lastSynced,
      })
      .eq("collection_address", collectionAddress.toLowerCase())
      .eq("token_id", tokenId)
      .eq("chain_id", env.chainId)

    if (error) {
      logger.error(
        {
          error,
          collectionAddress,
          tokenId,
          ownerWallet,
        },
        "❌ Failed to update NFT owner",
      )

      throw error
    }
  }
}
