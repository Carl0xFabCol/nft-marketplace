import type { IRpcProvider } from "./IRpcProvider"
import { ViemRpcProvider } from "./ViemRpcProvider"
import { env } from "../config/env"
import { logger } from "../utils/logger"
import type { BlockRange } from "../types/indexer.types"

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Factory for creating RPC providers based on configuration and block range requirements.
 * Automatically selects the appropriate provider (fast vs archive) based on block age.
 */
export class ProviderFactory {
  private static fastProvider: IRpcProvider | null = null
  private static archiveProvider: IRpcProvider | null = null
  private static fallbackProvider: IRpcProvider | null = null

  /**
   * Initialize providers from environment configuration.
   * Call this once at application startup.
   */
  static initialize(): void {
    // Primary fast provider (required)
    this.fastProvider = new ViemRpcProvider({
      name: "fast-primary",
      url: env.fastRpcUrl,
      type: "fast",
      chainId: env.chainId,
      ...(env.fastRpcToken && {
        headers: {
          "X-API-Key": env.fastRpcToken,
        },
      }),
    })

    // Archive provider (optional)
    if (env.archiveRpcUrl) {
      // If archive URL differs from fast URL, use archive-specific token if available,
      // otherwise fall back to fast token (Conduit API key covers multiple endpoints)
      const archiveUsesSeparateToken = env.archiveRpcUrl !== env.fastRpcUrl && env.archiveRpcToken
      const archiveToken = archiveUsesSeparateToken ? env.archiveRpcToken : env.fastRpcToken

      this.archiveProvider = new ViemRpcProvider({
        name: "archive",
        url: env.archiveRpcUrl,
        type: "archive",
        chainId: env.chainId,
        ...(archiveToken && {
          headers: {
            "X-API-Key": archiveToken,
          },
        }),
      })
      logger.info("✅ Archive RPC provider configured")
    } else {
      logger.warn("⚠️  No archive RPC provider configured. Historical block indexing may fail.")
    }

    // Fallback provider (optional)
    if (env.fallbackRpcUrl) {
      // If fallback URL differs from fast URL, use fallback-specific token if available,
      // otherwise fall back to fast token (Conduit API key covers multiple endpoints)
      const fallbackUsesSeparateToken = env.fallbackRpcUrl !== env.fastRpcUrl && env.fallbackRpcToken
      const fallbackToken = fallbackUsesSeparateToken ? env.fallbackRpcToken : env.fastRpcToken

      this.fallbackProvider = new ViemRpcProvider({
        name: "fallback",
        url: env.fallbackRpcUrl,
        type: "fast",
        chainId: env.chainId,
        ...(fallbackToken && {
          headers: {
            "X-API-Key": fallbackToken,
          },
        }),
      })
      logger.info("✅ Fallback RPC provider configured")
    }

    logger.info(
      {
        providers: {
          fast: !!this.fastProvider,
          archive: !!this.archiveProvider,
          fallback: !!this.fallbackProvider,
        },
      },
      "🏭 Provider factory initialized",
    )
  }

  /**
   * Get the primary fast provider.
   */
  static getFastProvider(): IRpcProvider {
    if (!this.fastProvider) {
      throw new Error("Provider factory not initialized. Call ProviderFactory.initialize() first.")
    }
    return this.fastProvider
  }

  /**
   * Get the archive provider if configured.
   */
  static getArchiveProvider(): IRpcProvider | null {
    return this.archiveProvider
  }

  /**
   * Get the fallback provider if configured.
   */
  static getFallbackProvider(): IRpcProvider | null {
    return this.fallbackProvider
  }

  /**
   * Get all available providers in priority order.
   * Returns [primary, fallback?, archive?]
   */
  static getAllProviders(): IRpcProvider[] {
    const providers: IRpcProvider[] = []

    if (this.fastProvider) providers.push(this.fastProvider)
    if (this.fallbackProvider) providers.push(this.fallbackProvider)
    if (this.archiveProvider) providers.push(this.archiveProvider)

    return providers
  }

  /**
   * Smart provider selection based on block range.
   * Returns archive provider for old blocks, fast provider for recent blocks.
   *
   * @param range - Block range to query
   * @param currentBlock - Current blockchain head
   * @returns Best provider for the given range
   */
  static selectProvider(range: BlockRange, currentBlock: bigint): IRpcProvider {
    // Blocks older than ~128 blocks typically require archive access
    const ARCHIVE_THRESHOLD = 128n
    const blockAge = currentBlock - range.to

    if (blockAge > ARCHIVE_THRESHOLD) {
      // Old blocks - prefer archive if available
      if (this.archiveProvider) {
        logger.debug(
          {
            fromBlock: range.from.toString(),
            toBlock: range.to.toString(),
            blockAge: blockAge.toString(),
            provider: "archive",
          },
          "🏛️  Using archive provider for historical range",
        )
        return this.archiveProvider
      } else {
        logger.warn(
          {
            fromBlock: range.from.toString(),
            toBlock: range.to.toString(),
            blockAge: blockAge.toString(),
          },
          "⚠️  Archive provider needed but not configured, using fast provider (may fail)",
        )
      }
    }

    // Recent blocks - use fast provider
    logger.debug(
      {
        fromBlock: range.from.toString(),
        toBlock: range.to.toString(),
        blockAge: blockAge.toString(),
        provider: "fast",
      },
      "⚡ Using fast provider for recent range",
    )

    return this.getFastProvider()
  }
}
