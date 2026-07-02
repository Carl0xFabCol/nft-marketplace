import type { ProviderPool } from "../providers/ProviderPool"
import type { BatchEventFetcher } from "../fetchers/BatchEventFetcher"
import type { HandlerRegistry } from "../handlers/HandlerRegistry"
import type { IndexerStateRepository } from "../persistence/IndexerStateRepository"
import type { ContractConfig } from "../types/indexer.types"
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
   * 1. Get last indexed block from state
   * 2. Get current chain block
   * 3. Fetch events in batches
   * 4. Dispatch to handlers
   * 5. Update state
   */
  private async runSingleIteration(): Promise<void> {
    this.currentRun++
    logger.info({ run: this.currentRun }, "🔄 Starting indexer run...")

    try {
      // Step 1: Get indexer state
      const state = await this.stateRepo.getState(this.config.chainId)
      if (!state) {
        logger.error({ chainId: this.config.chainId }, "❌ No indexer state found for chain")
        return
      }

      const fromBlock = BigInt(state.last_block + 1)

      // Step 2: Get current block number
      const currentBlock = await this.providerPool.executeWithFallback(async (provider) => {
        return await provider.getBlockNumber()
      })

      if (!currentBlock) {
        logger.error("❌ Failed to get current block number from all providers")
        return
      }

      let toBlock = currentBlock

      // Check if we're already synced
      if (fromBlock > toBlock) {
        logger.debug(
          {
            fromBlock: fromBlock.toString(),
            toBlock: toBlock.toString(),
          },
          "✨ Already synced, nothing to index",
        )
        return
      }

      // Step 3: Limit batch size to avoid overwhelming the RPC
      if (toBlock > fromBlock + BigInt(this.config.batchSize)) {
        toBlock = fromBlock + BigInt(this.config.batchSize)
        logger.info(
          {
            fromBlock: fromBlock.toString(),
            toBlock: toBlock.toString(),
            batchSize: this.config.batchSize,
          },
          "📦 Limiting to batch size",
        )
      }

      logger.info(
        {
          fromBlock: fromBlock.toString(),
          toBlock: toBlock.toString(),
          blockRange: (toBlock - fromBlock + BigInt(1)).toString(),
        },
        "🔍 Fetching events...",
      )

      // Step 4: Fetch all events from all registered contracts
      const events = await this.eventFetcher.fetchEventsInRange(this.contracts, fromBlock, toBlock)

      logger.info(
        {
          eventCount: events.length,
          fromBlock: fromBlock.toString(),
          toBlock: toBlock.toString(),
        },
        `📊 Fetched ${events.length} events`,
      )

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

      // Step 6: Update indexer state
      await this.stateRepo.updateLastBlock(this.config.chainId, Number(toBlock))

      logger.info(
        {
          run: this.currentRun,
          lastBlock: toBlock.toString(),
          eventsProcessed: events.length,
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
