import { erc721Abi, type Address } from "viem"
import type { IRpcProvider } from "../providers/IRpcProvider"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// METADATA FETCHER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetches NFT and collection metadata from contracts and IPFS.
 * Extracted from the main indexer logic for better separation of concerns.
 */
export class MetadataFetcher {
  private provider: IRpcProvider

  constructor(provider: IRpcProvider) {
    this.provider = provider
  }

  /**
   * Get the tokenURI for an NFT.
   */
  async getTokenURI(contractAddress: Address, tokenId: string): Promise<string | null> {
    try {
      const uri = await this.provider.readContract<string>({
        address: contractAddress,
        abi: erc721Abi,
        functionName: "tokenURI",
        args: [BigInt(tokenId)],
      })

      return uri
    } catch (error) {
      logger.debug(
        {
          contractAddress,
          tokenId,
          error: error instanceof Error ? error.message : String(error),
        },
        "⚠️  Failed to fetch tokenURI",
      )
      return null
    }
  }

  /**
   * Fetch metadata JSON from a URI (supports IPFS).
   */
  async fetchMetadata(uri: string): Promise<Record<string, unknown> | null> {
    if (!uri) return null

    try {
      // Convert IPFS URIs to HTTP gateway
      let fetchUri = uri
      if (uri.startsWith("ipfs://")) {
        fetchUri = uri.replace("ipfs://", "https://ipfs.io/ipfs/")
      }

      const response = await fetch(fetchUri, {
        signal: AbortSignal.timeout(10000), // 10s timeout
      })

      if (!response.ok) {
        logger.debug({ uri, status: response.status }, "⚠️  Metadata fetch failed")
        return null
      }

      const metadata = await response.json()
      return metadata as Record<string, unknown>
    } catch (error) {
      logger.debug(
        {
          uri,
          error: error instanceof Error ? error.message : String(error),
        },
        "⚠️  Failed to fetch metadata",
      )
      return null
    }
  }

  /**
   * Get collection metadata (name and symbol).
   */
  async getCollectionMetadata(collectionAddress: Address): Promise<{ name: string; symbol: string }> {
    try {
      const [name, symbol] = await Promise.all([
        this.provider
          .readContract<string>({
            address: collectionAddress,
            abi: erc721Abi,
            functionName: "name",
          })
          .catch(() => "Unknown"),
        this.provider
          .readContract<string>({
            address: collectionAddress,
            abi: erc721Abi,
            functionName: "symbol",
          })
          .catch(() => "UNKNOWN"),
      ])

      return { name, symbol }
    } catch (error) {
      logger.warn(
        {
          collectionAddress,
          error: error instanceof Error ? error.message : String(error),
        },
        "⚠️  Failed to fetch collection metadata",
      )
      return { name: "Unknown", symbol: "UNKNOWN" }
    }
  }

  /**
   * Get full NFT data including metadata from IPFS.
   */
  async getNFTData(
    collectionAddress: Address,
    tokenId: string,
  ): Promise<{
    tokenUri: string | null
    metadata: Record<string, unknown> | null
    imageUrl: string | null
  }> {
    const tokenUri = await this.getTokenURI(collectionAddress, tokenId)
    const metadata = tokenUri ? await this.fetchMetadata(tokenUri) : null

    let imageUrl: string | null = null
    if (metadata?.image && typeof metadata.image === "string") {
      imageUrl = metadata.image
      if (imageUrl.startsWith("ipfs://")) {
        imageUrl = imageUrl.replace("ipfs://", "https://ipfs.io/ipfs/")
      }
    }

    return {
      tokenUri,
      metadata,
      imageUrl,
    }
  }
}
