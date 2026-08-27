import { erc721Abi, type Address } from "viem"
import type { ProviderPool } from "../providers/ProviderPool"
import type { BatchEventFetcher } from "../fetchers/BatchEventFetcher"
import type { HandlerRegistry } from "../handlers/HandlerRegistry"
import type { IndexerStateRepository } from "../persistence/IndexerStateRepository"
import type { ContractIndexerStateRepository } from "../persistence/ContractIndexerStateRepository"
import type { CollectionsRepository } from "../persistence/CollectionsRepository"
import type { ContractConfig, ContractFetchRequest } from "../types/indexer.types"
import { logger } from "../utils/logger"
import { CHAIN_IDS } from "@marketplace/shared"

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXER ORCHESTRATOR - THE HEART OF THE INDEXER
// ═══════════════════════════════════════════════════════════════════════════════

export interface IndexerOrchestratorConfig {
  pollingIntervalMs: number
  batchSize: number
  chainId: number
}

/**
 * IndexerOrchestrator coordinates the indexing process.
 * It runs a polling loop that fetches events and dispatches them to handlers.
 * This is the main orchestration layer that ties everything together.
 */
export class IndexerOrchestrator {
  private running = false
  private shouldStop = false
  private currentRun = 0

  constructor(
    private providerPool: ProviderPool,
    private eventFetcher: BatchEventFetcher,
    private handlerRegistry: HandlerRegistry,
    private stateRepo: IndexerStateRepository,
    private contractStateRepo: ContractIndexerStateRepository,
    private collectionsRepo: CollectionsRepository,
    private contracts: ContractConfig[],
    private config: IndexerOrchestratorConfig,
  ) {}

  /**
   * Start the indexer orchestration loop.
   * This will run continuously until stop() is called or an unrecoverable error occurs.
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn("🚨 Indexer is already running, ignoring start() call")
      return
    }

    this.running = true
    this.shouldStop = false

    logger.info(
      {
        pollingIntervalMs: this.config.pollingIntervalMs,
        batchSize: this.config.batchSize,
        chainId: this.config.chainId,
      },
      "🚀 Starting IndexerOrchestrator...",
    )

    await this.runLoop()
  }

  /**
   * Stop the indexer gracefully.
   * Will complete the current run before stopping.
   */
  stop(): void {
    logger.info("⏹️  Stop requested, will finish current run and exit...")
    this.shouldStop = true
  }

  /**
   * Main polling loop - runs continuously until stopped.
   */
  private async runLoop(): Promise<void> {
    while (!this.shouldStop) {
      try {
        await this.runSingleIteration()
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            run: this.currentRun,
          },
          "❌ Fatal error in indexer loop iteration",
        )
        // Don't crash - continue to next iteration after delay
      }

      // Wait before next iteration
      if (!this.shouldStop) {
        await this.sleep(this.config.pollingIntervalMs)
      }
    }

    this.running = false
    logger.info("✅ IndexerOrchestrator stopped gracefully")
  }

  /**
   * Execute a single indexing iteration:
   * 1. Get last indexed block from global state
   * 2. Discover active collection contracts from collections table
   * 3. Determine per-contract fromBlock (global for core/bids, per-contract for collections)
   * 4. Get current chain block
   * 5. Fetch events in batches (per-contract fromBlock)
   * 6. Dispatch to handlers
   * 7. Update global + per-contract state
   */
  private async runSingleIteration(): Promise<void> {
    this.currentRun++
    logger.info({ run: this.currentRun }, "🔄 Starting indexer run...")

    try {
      // Step 1: Get global indexer state (for core, bids contracts)
      const state = await this.stateRepo.getState(this.config.chainId)
      if (!state) {
        logger.error({ chainId: this.config.chainId }, "❌ No indexer state found for chain")
        return
      }

      const globalFromBlock = BigInt(state.last_block + 1)

      // Step 2: Discover active collections and build per-contract state
      const collections = await this.collectionsRepo.getAll()

      // Build contract fetch requests:
      // - Static contracts (core, bids) use global fromBlock
      // - Dynamic collection contracts use per-contract fromBlock from contract_indexer_state
      const fetchRequests: ContractFetchRequest[] = []

      // Static contracts
      for (const contract of this.contracts) {
        fetchRequests.push({ contract, fromBlock: globalFromBlock })
      }

      // Dynamic collection contracts
      for (const collection of collections) {
        const collectionAddress = collection.contract_address as string
        const indexerBlock = collection.indexer_block as number

        // Get per-contract state (last_block processed)
        const contractState = await this.contractStateRepo.getContractState(collectionAddress, this.config.chainId)

        // If no state exists, start from the collection's indexer_block (registration block)
        // If state exists, continue from last_block + 1
        const contractFromBlock = contractState
          ? BigInt(contractState.last_block + 1)
          : BigInt(indexerBlock)

        fetchRequests.push({
          contract: {
            name: "nft",
            address: collectionAddress as `0x${string}`,
            abi: erc721Abi,
            events: ["Transfer"],
          } as ContractConfig,
          fromBlock: contractFromBlock,
        })
      }

      // Step 3: Get current block number
      const currentBlock = await this.providerPool.executeWithFallback(async (provider) => {
        return await provider.getBlockNumber()
      })

      if (!currentBlock) {
        logger.error("❌ Failed to get current block number from all providers")
        return
      }

      const toBlock = currentBlock

      logger.info(
        {
          globalFromBlock: globalFromBlock.toString(),
          toBlock: toBlock.toString(),
          contracts: fetchRequests.map((r) => ({ name: r.contract.name, fromBlock: r.fromBlock.toString() })),
        },
        "🔍 Fetching events...",
      )

      // Step 4: Fetch all events from all contracts (per-contract fromBlock)
      const events = await this.eventFetcher.fetchEventsForContracts(fetchRequests, toBlock)

      logger.info(
        {
          eventCount: events.length,
          toBlock: toBlock.toString(),
          contracts: fetchRequests.length,
        },
        `📊 Fetched ${events.length} events`,
      )

      // Log warning if no events found despite block range having blocks to process
      if (events.length === 0) {
        const minFromBlock = fetchRequests.reduce(
          (min, req) => (req.fromBlock < min ? req.fromBlock : min),
          fetchRequests[0]?.fromBlock ?? 0n,
        )
        const blockRange = toBlock - minFromBlock + BigInt(1)
        if (blockRange > 0) {
          logger.warn(
            {
              fromBlock: minFromBlock.toString(),
              toBlock: toBlock.toString(),
              blockRange: blockRange.toString(),
              contracts: fetchRequests.map((r) => r.contract.name),
            },
            "⚠️ No events found in range - check RPC connectivity, contract addresses, or event filters",
          )
        }
      }

      // Step 5: Process each event through the handler registry
      if (events.length > 0) {
        let successCount = 0
        let errorCount = 0

        for (const event of events) {
          try {
            await this.handlerRegistry.dispatch(event)
            successCount++
          } catch (error) {
            errorCount++
            logger.error(
              {
                error: error instanceof Error ? error.message : String(error),
                eventName: event.eventName,
                contractAddress: event.contractAddress,
                blockNumber: event.blockNumber.toString(),
                txHash: event.transactionHash,
              },
              "❌ Error processing event",
            )
            // Continue processing other events - don't let one failure stop the whole batch
          }
        }

        logger.info(
          {
            total: events.length,
            success: successCount,
            errors: errorCount,
          },
          `✅ Processed events: ${successCount} success, ${errorCount} errors`,
        )
      }

      // Step 6: Update global indexer state (for core/bids contracts)
      await this.stateRepo.updateLastBlock(this.config.chainId, Number(toBlock))

      // Step 7: Update per-contract indexer state for collection contracts
      for (const collection of collections) {
        const collectionAddress = collection.contract_address as string
        await this.contractStateRepo.upsertContractState(
          collectionAddress,
          this.config.chainId,
          Number(toBlock),
        )
      }

      logger.info(
        {
          run: this.currentRun,
          lastBlock: toBlock.toString(),
          eventsProcessed: events.length,
          perContractUpdates: collections.length,
        },
        `✅ Run #${this.currentRun} complete`,
      )
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          run: this.currentRun,
        },
        "❌ Error in indexer iteration",
      )
      // Error is caught by runLoop, will retry on next iteration
      throw error
    }
  }

  /**
   * Sleep utility for polling interval
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Get current running status
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Get current run count
   */
  getCurrentRun(): number {
    return this.currentRun
  }
}
