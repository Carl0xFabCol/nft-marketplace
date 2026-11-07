import { erc721Abi } from "viem"
import { BlockRangeUtil } from "../utils/BlockRange"
import type { ProviderPool } from "../providers/ProviderPool"
import type { BatchEventFetcher } from "../fetchers/BatchEventFetcher"
import type { HandlerRegistry } from "../handlers/HandlerRegistry"
import type { IndexerStateRepository } from "../persistence/IndexerStateRepository"
import type { ContractIndexerStateRepository } from "../persistence/ContractIndexerStateRepository"
import type { CollectionsRepository } from "../persistence/CollectionsRepository"
import type { ContractConfig, ContractFetchRequest, ParsedEvent } from "../types/indexer.types"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXER ORCHESTRATOR - THE HEART OF THE INDEXER
// ═══════════════════════════════════════════════════════════════════════════════

export interface IndexerOrchestratorConfig {
  pollingIntervalMs: number
  batchSize: number
  chainId: number
  /** Blocks behind the head that are not indexed yet (env CONFIRMATIONS). */
  confirmations: number
}

interface CollectionCursor {
  address: string
  /** Last block fully processed for this collection's Transfer events. */
  last: bigint
}

interface IterationPlan {
  /** Last block fully processed for the static contracts (core, bids). */
  globalLast: bigint
  collectionCursors: CollectionCursor[]
  fetchRequests: ContractFetchRequest[]
  /** Lowest block any contract still needs (start of the first chunk). */
  minFromBlock: bigint
  /** head - confirmations: the highest block this run may index. */
  safeHead: bigint
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
  private consecutiveFailedRuns = 0

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
        confirmations: this.config.confirmations,
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
   * Execute a single indexing iteration.
   *
   * Cursor semantics (IDX-2 / IDX-3):
   * - Only blocks at or below `safeHead = head - confirmations` are indexed.
   * - Events are dispatched in on-chain order. Processing STOPS at the first
   *   event whose handler throws (block B): later events are not run, so they
   *   are not replayed twice. Every cursor then moves to at most B - 1, so the
   *   next iteration re-fetches from B and retries the failed event. Without a
   *   failure the cursors move to safeHead.
   * - Cursors only move forward: a provider reporting a lower head, or a
   *   failure below an already-written cursor, never rewinds them
   *   (IndexerStateRepository also guards this in the UPDATE itself).
   * - Replay window on retry: the events of block B that ran before the
   *   failing one. Activity and stats are idempotent on (tx_hash, log_index);
   *   bid inserts are not yet (IDX-7, Phase 3B).
   *
   * Streaming (IDX-8): [minFromBlock, safeHead] is split into batchSize
   * chunks. Each chunk is fetched, processed and checkpointed before the next
   * one is fetched, so a long backfill keeps its progress when a later chunk
   * fails and never holds more than one chunk of events in memory. A fetch
   * error ends the run; chunks before it stay checkpointed.
   *
   * Not handled here: reorgs deeper than the confirmation lag (no
   * last_block_hash yet; Phase 3B).
   */
  private async runSingleIteration(): Promise<void> {
    this.currentRun++
    logger.info({ run: this.currentRun }, "🔄 Starting indexer run...")

    try {
      const plan = await this.buildPlan()
      if (!plan) return

      const { fetchRequests, minFromBlock, safeHead } = plan
      const chunks = BlockRangeUtil.chunk(minFromBlock, safeHead, this.config.batchSize)

      logger.info(
        {
          fromBlock: minFromBlock.toString(),
          safeHead: safeHead.toString(),
          chunks: chunks.length,
          contracts: fetchRequests.map((r) => ({ name: r.contract.name, fromBlock: r.fromBlock.toString() })),
        },
        "🔍 Fetching events...",
      )

      let eventsProcessed = 0
      for (const chunk of chunks) {
        if (this.shouldStop) {
          logger.info({ stoppedBefore: chunk.from.toString() }, "⏹️  Stop requested; ending run between chunks")
          return
        }

        const events = await this.eventFetcher.fetchChunk(fetchRequests, chunk.from, chunk.to)
        logger.debug({ from: chunk.from.toString(), to: chunk.to.toString(), events: events.length }, "📦 Chunk fetched")

        const failedAtBlock = await this.processEvents(events)
        const target = failedAtBlock === null ? chunk.to : failedAtBlock - 1n
        await this.checkpoint(plan, target)

        if (failedAtBlock !== null) {
          this.recordFailedRun(failedAtBlock, target)
          return
        }
        eventsProcessed += events.length
      }

      this.consecutiveFailedRuns = 0
      logger.info(
        { run: this.currentRun, lastBlock: safeHead.toString(), eventsProcessed, chunks: chunks.length },
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

  private recordFailedRun(failedAtBlock: bigint, cursor: bigint): void {
    this.consecutiveFailedRuns++
    logger.error(
      {
        run: this.currentRun,
        failedAtBlock: failedAtBlock.toString(),
        cursor: cursor.toString(),
        consecutiveFailedRuns: this.consecutiveFailedRuns,
      },
      "❌ Run stopped at a failed event; cursor held before it, the event is retried next run",
    )
  }

  /**
   * Read the cursors, discover collection contracts and compute the safe head.
   * Returns null when there is nothing to index yet.
   */
  private async buildPlan(): Promise<IterationPlan | null> {
    // Global indexer state (core, bids)
    const state = await this.stateRepo.getState(this.config.chainId)
    if (!state) {
      logger.error({ chainId: this.config.chainId }, "❌ No indexer state found for chain")
      return null
    }
    const globalLast = BigInt(state.last_block)

    // Static contracts use the global cursor.
    const fetchRequests: ContractFetchRequest[] = this.contracts.map((contract) => ({ contract, fromBlock: globalLast + 1n }))

    // Dynamic collection contracts use contract_indexer_state, or start at
    // their registration block (indexer_block) when they have no row yet.
    const collections = await this.collectionsRepo.getAll(this.config.chainId)
    const collectionCursors: CollectionCursor[] = []
    for (const collection of collections) {
      const address = collection.contract_address as string
      const contractState = await this.contractStateRepo.getContractState(address, this.config.chainId)
      const last = contractState ? BigInt(contractState.last_block) : BigInt(collection.indexer_block as number) - 1n
      collectionCursors.push({ address, last })
      fetchRequests.push({
        contract: {
          name: "nft",
          address: address as `0x${string}`,
          abi: erc721Abi,
          events: ["Transfer"],
        } as ContractConfig,
        fromBlock: last + 1n,
      })
    }

    const head = await this.providerPool.executeWithFallback(async (provider) => provider.getBlockNumber())
    if (head === null || head === undefined) {
      logger.error("❌ Failed to get current block number from all providers")
      return null
    }

    const safeHead = head - BigInt(this.config.confirmations)
    const minFromBlock = fetchRequests.reduce((min, r) => (r.fromBlock < min ? r.fromBlock : min), globalLast + 1n)

    if (safeHead < minFromBlock) {
      logger.info(
        { head: head.toString(), confirmations: this.config.confirmations, nextBlock: minFromBlock.toString() },
        "⏳ No confirmed blocks to index yet",
      )
      return null
    }

    return { globalLast, collectionCursors, fetchRequests, minFromBlock, safeHead }
  }

  /**
   * Dispatch events in order and stop at the first failure.
   * @returns the block of the failed event, or null if every event succeeded.
   */
  private async processEvents(events: ParsedEvent[]): Promise<bigint | null> {
    let processed = 0
    for (const event of events) {
      try {
        await this.handlerRegistry.dispatch(event)
        processed++
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            eventName: event.eventName,
            contractAddress: event.contractAddress,
            blockNumber: event.blockNumber.toString(),
            txHash: event.transactionHash,
            logIndex: event.logIndex,
            processedBefore: processed,
            notRun: events.length - processed - 1,
          },
          "❌ Error processing event; stopping this run at its block",
        )
        return event.blockNumber
      }
    }
    if (events.length > 0) logger.info({ total: events.length }, `✅ Processed ${events.length} events`)
    return null
  }

  /**
   * Move every cursor forward to `target`, never backwards. The global cursor
   * covers core/bids; each collection has its own row in contract_indexer_state.
   */
  private async checkpoint(plan: IterationPlan, target: bigint): Promise<void> {
    if (target > plan.globalLast) {
      await this.stateRepo.updateLastBlock(this.config.chainId, Number(target))
      plan.globalLast = target
    }
    for (const cursor of plan.collectionCursors) {
      if (target > cursor.last) {
        await this.contractStateRepo.upsertContractState(cursor.address, this.config.chainId, Number(target))
        cursor.last = target
      }
    }
  }

  /**
   * Sleep utility for polling interval
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /** Run exactly one iteration (used by tests and one-shot tooling). */
  async runOnce(): Promise<void> {
    await this.runSingleIteration()
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
