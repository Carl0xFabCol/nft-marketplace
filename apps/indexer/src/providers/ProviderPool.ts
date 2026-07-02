import type { IRpcProvider } from "./IRpcProvider"
import { ProviderFactory } from "./ProviderFactory"
import { logger, loggerHelpers } from "../utils/logger"
import { withRetry } from "../utils/retry"

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER POOL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Manages a pool of RPC providers with automatic fallback and retry logic.
 * If the primary provider fails, automatically switches to fallback providers.
 *
 * This implements the resilience strategy:
 * 1. Try primary provider with retries
 * 2. If primary exhausted, try fallback provider with retries
 * 3. If all providers fail, throw error
 */
export class ProviderPool {
  private providers: IRpcProvider[]
  private currentIndex: number = 0

  constructor(providers?: IRpcProvider[]) {
    this.providers = providers || ProviderFactory.getAllProviders()

    if (this.providers.length === 0) {
      throw new Error("ProviderPool requires at least one provider")
    }

    logger.info({ providerCount: this.providers.length, providers: this.providers.map((p) => p.name) }, "🏊 Provider pool initialized")
  }

  /**
   * Execute an operation with automatic provider fallback.
   * If an operation fails on one provider, tries the next provider in the pool.
   *
   * @param operation - Function that uses a provider to perform an operation
   * @param gracefulDegradation - If true, returns null on failure instead of throwing
   * @returns Result of the operation or null if gracefulDegradation is enabled
   */
  async executeWithFallback<T>(operation: (provider: IRpcProvider) => Promise<T>, gracefulDegradation: boolean = false): Promise<T | null> {
    let lastError: Error | unknown

    // Try each provider in sequence
    for (let attempt = 0; attempt < this.providers.length; attempt++) {
      const provider = this.getNextProvider()

      try {
        // Execute with retry logic for this specific provider
        const result = await withRetry(() => operation(provider), {
          maxAttempts: 2, // Fewer retries per provider since we have fallbacks
          initialBackoffMs: 500,
        })

        // Success! Reset index to prefer this provider for next call
        if (attempt > 0) {
          logger.info({ successfulProvider: provider.name, attemptNumber: attempt + 1 }, "✅ Provider fallback succeeded")
        }

        return result
      } catch (error) {
        lastError = error
        const errorMessage = error instanceof Error ? error.message : String(error)

        // Check if this is an archive-related error
        const isArchiveError =
          errorMessage.toLowerCase().includes("missing trie node") ||
          errorMessage.toLowerCase().includes("header not found") ||
          errorMessage.toLowerCase().includes("block not available") ||
          errorMessage.toLowerCase().includes("archive") ||
          errorMessage.toLowerCase().includes("pruned")

        if (isArchiveError && gracefulDegradation) {
          logger.warn(
            {
              provider: provider.name,
              error: errorMessage,
            },
            "⚠️  Archive access required but not available. Skipping gracefully.",
          )
          return null
        }

        // If there's a next provider, log fallback
        if (attempt < this.providers.length - 1) {
          const nextProvider = this.providers[this.currentIndex]
          loggerHelpers.providerFallback(provider.name, nextProvider.name, error)
        } else {
          // Last provider also failed
          logger.error(
            {
              provider: provider.name,
              error: errorMessage,
              totalAttempts: this.providers.length,
            },
            "❌ All providers exhausted",
          )
        }
      }
    }

    // All providers failed
    if (gracefulDegradation) {
      logger.warn("⚠️  All providers failed, but graceful degradation enabled. Returning null.")
      return null
    }

    throw lastError
  }

  /**
   * Get the next provider in the pool (round-robin).
   */
  private getNextProvider(): IRpcProvider {
    const provider = this.providers[this.currentIndex]
    this.currentIndex = (this.currentIndex + 1) % this.providers.length
    return provider
  }

  /**
   * Reset the pool to start from the first provider.
   */
  reset(): void {
    this.currentIndex = 0
  }

  /**
   * Check health of all providers.
   */
  async checkHealth(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {}

    await Promise.all(
      this.providers.map(async (provider) => {
        health[provider.name] = await provider.isHealthy()
      }),
    )

    logger.info({ health }, "🏥 Provider health check complete")
    return health
  }
}
