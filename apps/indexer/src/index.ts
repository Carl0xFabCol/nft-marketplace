import "dotenv/config"
import { supabase } from "./supabase"
import { logger } from "./utils/logger"
import { env } from "./config/env"
import { CONTRACTS_TO_INDEX } from "./config/contracts.config"

// Providers
import { ProviderPool } from "./providers/ProviderPool"
import { ViemRpcProvider } from "./providers/ViemRpcProvider"
import type { IRpcProvider } from "./providers/IRpcProvider"

// Fetchers
import { BatchEventFetcher } from "./fetchers/BatchEventFetcher"
import { MetadataFetcher } from "./fetchers/MetadataFetcher"

// Repositories
import { ActivityRepository } from "./persistence/ActivityRepository"
import { CollectionsRepository } from "./persistence/CollectionsRepository"
import { ListingsRepository } from "./persistence/ListingsRepository"
import { BidsRepository } from "./persistence/BidsRepository"
import { NFTRepository } from "./persistence/NFTRepository"
import { IndexerStateRepository } from "./persistence/IndexerStateRepository"
import { ContractIndexerStateRepository } from "./persistence/ContractIndexerStateRepository"

// Handlers
import { HandlerRegistry } from "./handlers/HandlerRegistry"
import { createCoreEventHandlers } from "./handlers/CoreEventHandler"
import { createBidsEventHandlers } from "./handlers/BidsEventHandler"
import { TransferHandler } from "./handlers/TransferHandler"
import type { IEventHandler } from "./handlers/IEventHandler"

// Orchestrator
import { IndexerOrchestrator } from "./services/IndexerOrchestrator"

// ═══════════════════════════════════════════════════════════════════════════════
// MARKETPLACE INDEXER - ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  logger.info("🚀 Starting Marketplace Indexer...")

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. INITIALIZE PROVIDER POOL
  // ─────────────────────────────────────────────────────────────────────────────

  // Helper to get the appropriate token for a given URL
  const getTokenForUrl = (url: string): string | undefined => {
    // If this is the fast URL, use fastRpcToken
    if (url === env.fastRpcUrl) {
      return env.fastRpcToken
    }
    // If this is the archive URL and different from fast, use archiveRpcToken, else fast token
    if (url === env.archiveRpcUrl) {
      return (url !== env.fastRpcUrl && env.archiveRpcToken) ? env.archiveRpcToken : env.fastRpcToken
    }
    // If this is the fallback URL and different from fast, use fallbackRpcToken, else fast token
    if (url === env.fallbackRpcUrl) {
      return (url !== env.fastRpcUrl && env.fallbackRpcToken) ? env.fallbackRpcToken : env.fastRpcToken
    }
    return env.fastRpcToken
  }

  // Conduit API key - use for all providers if set (takes precedence over individual tokens)
  const conduitToken = env.conduitApiKey

  // Helper to build provider config with optional headers
  const buildProviderConfig = (
    name: string,
    url: string,
    type: "fast" | "archive",
    chainId: number,
  ): { name: string; url: string; type: "fast" | "archive"; chainId: number; headers?: Record<string, string> } => {
    const token = conduitToken || getTokenForUrl(url)
    const config = {
      name,
      url,
      type,
      chainId,
    } as { name: string; url: string; type: "fast" | "archive"; chainId: number; headers?: Record<string, string> }

    if (token) {
      config.headers = { "X-API-Key": token }
    }

    return config
  }

  // Check for duplicate URLs and log redundancy warnings
  const providerUrls = [env.fastRpcUrl, env.archiveRpcUrl, env.fallbackRpcUrl].filter(Boolean) as string[]
  const uniqueUrls = [...new Set(providerUrls)]
  if (uniqueUrls.length < providerUrls.length) {
    logger.warn(
      {
        totalProviders: providerUrls.length,
        uniqueUrls: uniqueUrls.length,
        duplicates: providerUrls.length - uniqueUrls.length,
      },
      "⚠️  Provider URL redundancy issue: Some providers share the same URL. No backup redundancy exists if this endpoint fails.",
    )
  }

  const providers: IRpcProvider[] = [
    new ViemRpcProvider(buildProviderConfig("fast", env.fastRpcUrl, "fast", env.chainId)),
  ]

  // Add archive provider if configured
  if (env.archiveRpcUrl) {
    providers.push(new ViemRpcProvider(buildProviderConfig("archive", env.archiveRpcUrl, "archive", env.chainId)))
  }

  // Add fallback provider if configured
  if (env.fallbackRpcUrl) {
    providers.push(new ViemRpcProvider(buildProviderConfig("fallback", env.fallbackRpcUrl, "fast", env.chainId)))
  }

  const providerPool = new ProviderPool(providers)

  // Health check
  await providerPool.checkHealth()

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. INITIALIZE FETCHERS
  // ─────────────────────────────────────────────────────────────────────────────

  // Get the first provider for fetchers (pool will handle fallback)
  const primaryProvider = await providerPool.executeWithFallback(async (p) => p)
  if (!primaryProvider) {
    throw new Error("Failed to get a working provider")
  }

  const eventFetcher = new BatchEventFetcher(primaryProvider, env.batchSize, env.maxParallelRequests)
  const metadataFetcher = new MetadataFetcher(primaryProvider)

  logger.info("✅ Fetchers initialized")

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. INITIALIZE REPOSITORIES
  // ─────────────────────────────────────────────────────────────────────────────

  const activityRepo = new ActivityRepository(supabase)
  const collectionsRepo = new CollectionsRepository(supabase)
  const listingsRepo = new ListingsRepository(supabase)
  const bidsRepo = new BidsRepository(supabase)
  const nftRepo = new NFTRepository(supabase)
  const stateRepo = new IndexerStateRepository(supabase)
  const contractStateRepo = new ContractIndexerStateRepository(supabase)

  logger.info("✅ Repositories initialized")

  // ─────────────────────────────────────────────────────────────────────────────
  // 3a. SEED CONTRACT INDEXER STATE FOR EXISTING COLLECTIONS
  // ─────────────────────────────────────────────────────────────────────────────
  // Initialize per-contract block tracking for all registered collections.
  // If a collection has no state entry, seed it with its indexer_block as the starting point.
  // This is idempotent — running it multiple times has no side effects.
  const existingCollections = await collectionsRepo.getAll()
  for (const collection of existingCollections) {
    const contractAddress = collection.contract_address as string
    const indexerBlock = collection.indexer_block as number

    const existingState = await contractStateRepo.getContractState(contractAddress, env.chainId)
    if (!existingState) {
      await contractStateRepo.upsertContractState(contractAddress, env.chainId, indexerBlock)
      logger.info({ contractAddress, lastBlock: indexerBlock }, "🌱 Seeded contract indexer state for collection")
    }
  }

  logger.info({ collectionsSeeded: existingCollections.length }, "✅ Contract indexer state seeded")

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. INITIALIZE HANDLER REGISTRY
  // ─────────────────────────────────────────────────────────────────────────────

  const handlerRegistry = new HandlerRegistry()

  // Register Core contract handlers
  const coreHandlers = createCoreEventHandlers(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher)

  for (const handler of coreHandlers) {
    handlerRegistry.register(handler)
  }

  // Register Bids contract handlers
  const bidsHandlers = createBidsEventHandlers(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher)

  for (const handler of bidsHandlers) {
    handlerRegistry.register(handler)
  }

  // Register NFT Transfer handler (for dynamically-registered collection contracts)
  const transferHandler = new TransferHandler(activityRepo, nftRepo) as IEventHandler<any>
  handlerRegistry.register(transferHandler)

  logger.info(
    {
      coreHandlers: coreHandlers.length,
      bidsHandlers: bidsHandlers.length,
      totalHandlers: coreHandlers.length + bidsHandlers.length + 1,
    },
    "✅ Event handlers registered",
  )

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. INITIALIZE ORCHESTRATOR
  // ─────────────────────────────────────────────────────────────────────────────

  const orchestrator = new IndexerOrchestrator(providerPool, eventFetcher, handlerRegistry, stateRepo, contractStateRepo, collectionsRepo, CONTRACTS_TO_INDEX, {
    pollingIntervalMs: env.pollingIntervalMs,
    batchSize: env.batchSize,
    chainId: env.chainId,
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. SETUP GRACEFUL SHUTDOWN
  // ─────────────────────────────────────────────────────────────────────────────

  const shutdown = (signal: string) => {
    logger.info({ signal }, "🛑 Shutdown signal received")
    orchestrator.stop()

    // Give it time to finish current iteration
    setTimeout(() => {
      if (orchestrator.isRunning()) {
        logger.warn("⚠️  Forcing shutdown after timeout")
        process.exit(0)
      }
    }, 30000) // 30 second grace period
  }

  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. START INDEXER
  // ─────────────────────────────────────────────────────────────────────────────

  logger.info(
    {
      contracts: CONTRACTS_TO_INDEX.map((c) => c.name),
      chainId: env.chainId,
      pollingIntervalMs: env.pollingIntervalMs,
      batchSize: env.batchSize,
    },
    "🎯 Configuration loaded",
  )

  await orchestrator.start()

  logger.info("👋 Indexer stopped gracefully")
}

// ═══════════════════════════════════════════════════════════════════════════════
// START APPLICATION
// ═══════════════════════════════════════════════════════════════════════════════

main().catch((error) => {
  logger.error(
    {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    "❌ Fatal error in main()",
  )
  process.exit(1)
})
