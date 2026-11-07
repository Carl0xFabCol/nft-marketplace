import "dotenv/config"
import { SUPPORTED_CHAIN_IDS } from "@marketplace/shared"
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
  /** Blocks behind the chain head that are not indexed yet (reorg safety margin). */
  confirmations: number

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

  // ADDR-3: no default chain. A missing CHAIN_ID used to fall back to Sepolia
  // (11155111) and index the wrong addresses into a 99801 database.
  const requiredChainId = (key: string): number => {
    const raw = required(key)
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || !(SUPPORTED_CHAIN_IDS as readonly number[]).includes(value)) {
      throw new Error(`❌ ${key} must be one of ${SUPPORTED_CHAIN_IDS.join(", ")}, got "${raw}"`)
    }
    return value
  }

  const optionalNonNegativeInt = (key: string, defaultValue: number): number => {
    const raw = process.env[key]
    if (raw === undefined || raw === "") return defaultValue
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`❌ ${key} must be a non-negative integer, got "${raw}"`)
    }
    return value
  }

  const optionalNumber = (key: string, defaultValue: number): number => {
    const value = process.env[key]
    return value ? Number(value) : defaultValue
  }

  return {
    // Chain
    // Which network this indexer process indexes. REQUIRED, no default: e.g.
    // CHAIN_ID=99801 (Elysium) or 11155111 (Sepolia). One process per network.
    // index.ts additionally refuses any RPC whose eth_chainId differs.
    chainId: requiredChainId("CHAIN_ID"),

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
    // IDX-3: only blocks at or below head - CONFIRMATIONS are indexed. 12 is
    // ~3 s on Elysium (Arbitrum Orbit, ~0.25 s blocks) and ~2.4 min on Sepolia.
    confirmations: optionalNonNegativeInt("CONFIRMATIONS", 12),

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
    confirmations: env.confirmations,
  },
  "⚙️  Configuration loaded",
)
