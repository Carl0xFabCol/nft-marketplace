import { erc721Abi, type Address } from "viem"
import type { IRpcProvider } from "../providers/IRpcProvider"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// METADATA FETCHER
// ═══════════════════════════════════════════════════════════════════════════════

const IPFS_GATEWAYS = [
  process.env.IPFS_GATEWAY,
  "https://gateway.pinata.cloud/ipfs",
  "https://dweb.link/ipfs",
  "https://ipfs.io/ipfs",
].filter((gateway): gateway is string => Boolean(gateway))

const METADATA_TIMEOUT_MS = 20000

function resolveGatewayUrl(uri: string, gateway: string): string {
  return uri.startsWith("ipfs://") ? uri.replace("ipfs://", `${gateway}/`) : uri
}

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

    const gateways = uri.startsWith("ipfs://") ? IPFS_GATEWAYS : [""]

    for (const gateway of gateways) {
      const fetchUri = resolveGatewayUrl(uri, gateway)

      try {
        const response = await fetch(fetchUri, {
          signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
        })

        if (!response.ok) {
          logger.debug({ uri, gateway, status: response.status }, "⚠️  Metadata fetch failed")
          continue
        }

        return (await response.json()) as Record<string, unknown>
      } catch (error) {
        logger.debug(
          {
            uri,
            gateway,
            error: error instanceof Error ? error.message : String(error),
          },
          "⚠️  Failed to fetch metadata",
        )
      }
    }

    return null
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
        const gateway = IPFS_GATEWAYS[0]
        if (gateway) {
          imageUrl = imageUrl.replace("ipfs://", `${gateway}/`)
        }
      }
    }

    return {
      tokenUri,
      metadata,
      imageUrl,
    }
  }
}
