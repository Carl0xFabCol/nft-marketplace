import "dotenv/config"
import { CHAIN_IDS } from "@marketplace/shared"
import { supabase } from "./supabase"
import { logger } from "./utils/logger"
import { env } from "./config/env"
import { CONTRACTS_TO_INDEX } from "./config/contracts.config"

// Providers
import { ProviderPool } from "./providers/ProviderPool"
import { ViemRpcProvider } from "./providers/ViemRpcProvider"

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

  const providers = [new ViemRpcProvider({ name: "fast", url: env.fastRpcUrl, type: "fast" })]

  // Add archive provider if configured
  if (env.archiveRpcUrl) {
    providers.push(new ViemRpcProvider({ name: "archive", url: env.archiveRpcUrl, type: "archive" }))
  }

  // Add fallback provider if configured
  if (env.fallbackRpcUrl) {
    providers.push(new ViemRpcProvider({ name: "fallback", url: env.fallbackRpcUrl, type: "fast" }))
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

    const existingState = await contractStateRepo.getContractState(contractAddress, CHAIN_IDS.SEPOLIA)
    if (!existingState) {
      await contractStateRepo.upsertContractState(contractAddress, CHAIN_IDS.SEPOLIA, indexerBlock)
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
    chainId: CHAIN_IDS.SEPOLIA,
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
      chainId: CHAIN_IDS.SEPOLIA,
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
