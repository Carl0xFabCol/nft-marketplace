import { logger } from "./logger"

// ═══════════════════════════════════════════════════════════════════════════════
// RETRY UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

export interface RetryOptions {
  maxAttempts?: number
  initialBackoffMs?: number
  maxBackoffMs?: number
  backoffMultiplier?: number
}

/**
 * Execute a function with exponential backoff retry logic.
 *
 * @param fn - The function to execute
 * @param options - Retry configuration
 * @returns The result of the function
 * @throws The last error if all attempts fail
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = Number(process.env.MAX_RETRY_ATTEMPTS) || 3, initialBackoffMs = Number(process.env.INITIAL_BACKOFF_MS) || 1000, maxBackoffMs = 30000, backoffMultiplier = 2 } = options

  let lastError: Error | unknown
  let backoffMs = initialBackoffMs

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt === maxAttempts) {
        logger.error(
          {
            attempt,
            maxAttempts,
            error: error instanceof Error ? error.message : String(error),
          },
          "❌ All retry attempts exhausted",
        )
        break
      }

      logger.warn(
        {
          attempt,
          maxAttempts,
          backoffMs,
          error: error instanceof Error ? error.message : String(error),
        },
        "⚠️  Retrying after error",
      )

      await sleep(backoffMs)
      backoffMs = Math.min(backoffMs * backoffMultiplier, maxBackoffMs)
    }
  }

  throw lastError
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Check if an error is retryable (network/timeout errors)
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()

  return message.includes("timeout") || message.includes("network") || message.includes("econnreset") || message.includes("enotfound") || message.includes("rate limit")
}
