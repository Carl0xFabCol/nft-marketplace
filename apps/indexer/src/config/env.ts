import "dotenv/config"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Centralized environment variable loading and validation.
 * Throws an error if required variables are missing.
 */

export interface EnvConfig {
  // Chain
  chainId: number

  // RPC Providers
  fastRpcUrl: string
  archiveRpcUrl?: string
  fallbackRpcUrl?: string
  fastRpcToken?: string
  archiveRpcToken?: string
  fallbackRpcToken?: string
  conduitApiKey?: string

  // Performance
  batchSize: number
  maxParallelRequests: number
  pollingIntervalMs: number

  // Retry & Resilience
  maxRetryAttempts: number
  initialBackoffMs: number

  // Supabase
  supabaseUrl: string
  supabaseServiceRoleKey: string

  // Etherscan
  etherscanApiKey?: string

  // Logging
  logLevel: string
  nodeEnv: string
}

function loadEnv(): EnvConfig {
  const required = (key: string): string => {
    const value = process.env[key]
    if (!value) {
      throw new Error(`❌ Missing required environment variable: ${key}`)
    }
    return value
  }

  const optional = (key: string, defaultValue?: string): string | undefined => {
    return process.env[key] || defaultValue
  }

  const optionalNumber = (key: string, defaultValue: number): number => {
    const value = process.env[key]
    return value ? Number(value) : defaultValue
  }

  return {
    // Chain
    // Which network this indexer instance/process is indexing. Defaults to Sepolia
    // (11155111) for backward compatibility with existing deployments that don't
    // set CHAIN_ID. To index Elysium, set CHAIN_ID=99801 (run a separate instance
    // per network — this indexer is single-chain-per-process).
    chainId: optionalNumber("CHAIN_ID", 11155111),

    // RPC Providers
    fastRpcUrl: required("FAST_RPC_URL"),
    archiveRpcUrl: optional("ARCHIVE_RPC_URL"),
    fallbackRpcUrl: optional("FALLBACK_RPC_URL"),
    fastRpcToken: optional("FAST_RPC_TOKEN"),
    archiveRpcToken: optional("ARCHIVE_RPC_TOKEN"),
    fallbackRpcToken: optional("FALLBACK_RPC_TOKEN"),
    conduitApiKey: optional("CONDUIT_API_KEY"),

    // Performance
    batchSize: optionalNumber("BATCH_SIZE", 5000),
    maxParallelRequests: optionalNumber("MAX_PARALLEL_REQUESTS", 3),
    pollingIntervalMs: optionalNumber("POLLING_INTERVAL_MS", 15000),

    // Retry & Resilience
    maxRetryAttempts: optionalNumber("MAX_RETRY_ATTEMPTS", 3),
    initialBackoffMs: optionalNumber("INITIAL_BACKOFF_MS", 1000),

    // Supabase
    supabaseUrl: required("SUPABASE_URL"),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),

    // Etherscan
    etherscanApiKey: optional("ETHERSCAN_API_KEY"),

    // Logging
    logLevel: optional("LOG_LEVEL", "info")!,
    nodeEnv: optional("NODE_ENV", "development")!,
  }
}

export const env = loadEnv()

logger.info(
  {
    chainId: env.chainId,
    fastRpcUrl: env.fastRpcUrl,
    hasArchiveRpc: !!env.archiveRpcUrl,
    hasFallbackRpc: !!env.fallbackRpcUrl,
    batchSize: env.batchSize,
    maxParallelRequests: env.maxParallelRequests,
    pollingIntervalMs: env.pollingIntervalMs,
  },
  "⚙️  Configuration loaded",
)
