import pino from "pino"

// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTURED LOGGER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Centralized logger using pino for structured logging.
 * - Production: JSON logs for parsing/monitoring
 * - Development: Pretty-printed colored logs with pino-pretty
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
})

/**
 * Log helpers for common patterns
 */
export const loggerHelpers = {
  /**
   * Log an RPC call with context
   */
  rpcCall: (provider: string, method: string, params?: Record<string, unknown>) => {
    logger.debug({ provider, method, params }, "🔌 RPC call")
  },

  /**
   * Log successful event fetching
   */
  eventsFetched: (provider: string, fromBlock: bigint, toBlock: bigint, count: number, durationMs: number) => {
    logger.info(
      {
        provider,
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
        count,
        durationMs,
      },
      "✅ Events fetched",
    )
  },

  /**
   * Log provider failover
   */
  providerFallback: (failedProvider: string, nextProvider: string, error: unknown) => {
    logger.warn(
      {
        failedProvider,
        nextProvider,
        error: error instanceof Error ? error.message : String(error),
      },
      "⚠️  Provider failed, switching to fallback",
    )
  },

  /**
   * Log batch processing
   */
  batchProcessing: (fromBlock: bigint, toBlock: bigint, chunks: number) => {
    logger.info(
      {
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
        chunks,
      },
      "📦 Processing blocks in batches",
    )
  },

  /**
   * Log event handling
   */
  eventHandled: (contractName: string, eventName: string, blockNumber: bigint) => {
    logger.debug(
      {
        contractName,
        eventName,
        blockNumber: blockNumber.toString(),
      },
      "🎯 Event handled",
    )
  },
}
