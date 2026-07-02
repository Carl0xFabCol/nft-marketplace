import type { SupabaseClient } from "@supabase/supabase-js"
import type { Address } from "viem"
import { logger } from "../utils/logger"

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
}
