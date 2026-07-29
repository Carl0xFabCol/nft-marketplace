import { decodeEventLog } from "viem"
import pMap from "p-map"
import type { IEventFetcher } from "./IEventFetcher"
import type { IRpcProvider } from "../providers/IRpcProvider"
import type { ContractConfig, ParsedEvent, RawContractEvent } from "../types/indexer.types"
import { BlockRangeUtil } from "../utils/BlockRange"
import { logger, loggerHelpers } from "../utils/logger"
import { env } from "../config/env"

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH EVENT FETCHER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * High-performance event fetcher that implements batching and parallelization.
 *
 * Features:
 * - Splits large block ranges into configurable chunks
 * - Fetches events from multiple contracts in parallel
 * - Decodes raw events into typed ParsedEvent objects
 * - Sorts events chronologically (by block number and log index)
 * - Structured logging with performance metrics
 */
export class BatchEventFetcher implements IEventFetcher {
  private provider: IRpcProvider
  private batchSize: number
  private maxParallelRequests: number

  constructor(provider: IRpcProvider, batchSize?: number, maxParallelRequests?: number) {
    this.provider = provider
    this.batchSize = batchSize ?? env.batchSize
    this.maxParallelRequests = maxParallelRequests ?? env.maxParallelRequests

    logger.debug(
      {
        provider: provider.name,
        batchSize: this.batchSize,
        maxParallelRequests: this.maxParallelRequests,
      },
      "📦 BatchEventFetcher initialized",
    )
  }

  /**
   * Fetch all events from multiple contracts within a block range.
   * Implements parallel fetching and automatic chunking for large ranges.
   */
  async fetchEventsInRange(contracts: ContractConfig[], fromBlock: bigint, toBlock: bigint): Promise<ParsedEvent[]> {
    const startTime = Date.now()

    // Split large ranges into chunks
    const ranges = BlockRangeUtil.chunk(fromBlock, toBlock, this.batchSize)

    loggerHelpers.batchProcessing(fromBlock, toBlock, ranges.length)

    // Fetch events from all contracts across all ranges (parallel)
    const allEvents = await pMap(
      ranges,
      async (range) => {
        return await this.fetchEventsForRange(contracts, range.from, range.to)
      },
      { concurrency: 1 }, // Process ranges sequentially to avoid overwhelming RPC
    )

    // Flatten and sort events
    const flatEvents = allEvents.flat()
    const sortedEvents = this.sortEvents(flatEvents)

    const duration = Date.now() - startTime

    logger.info(
      {
        provider: this.provider.name,
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
        contracts: contracts.length,
        chunks: ranges.length,
        totalEvents: sortedEvents.length,
        durationMs: duration,
        eventsPerSecond: Math.round((sortedEvents.length / duration) * 1000),
      },
      "✅ Batch event fetching complete",
    )

    return sortedEvents
  }

  /**
   * Fetch events from all contracts for a specific block range.
   * Contracts are fetched in parallel.
   */
  private async fetchEventsForRange(contracts: ContractConfig[], fromBlock: bigint, toBlock: bigint): Promise<ParsedEvent[]> {
    const startTime = Date.now()

    // Fetch all contracts in parallel
    const contractEvents = await pMap(
      contracts,
      async (contract) => {
        return await this.fetchContractEvents(contract, fromBlock, toBlock)
      },
      { concurrency: this.maxParallelRequests },
    )

    const flatEvents = contractEvents.flat()
    const duration = Date.now() - startTime

    logger.debug(
      {
        provider: this.provider.name,
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
        contracts: contracts.length,
        events: flatEvents.length,
        durationMs: duration,
      },
      "📥 Range fetched",
    )

    return flatEvents
  }

  /**
   * Fetch and parse events from a single contract.
   * Iterates over each event name defined in the contract's events array.
   */
  private async fetchContractEvents(contract: ContractConfig, fromBlock: bigint, toBlock: bigint): Promise<ParsedEvent[]> {
    try {
      // If contract has specific events defined, fetch each one individually
      // This is more reliable than fetching all events at once
      if (contract.events && contract.events.length > 0) {
        logger.debug(
          {
            contract: contract.name,
            events: contract.events,
            fromBlock: fromBlock.toString(),
            toBlock: toBlock.toString(),
          },
          "📡 Fetching specific events from contract",
        )

        // Fetch each event type separately for better reliability
        const allEventsByType = await Promise.all(
          contract.events.map(async (eventName) => {
            try {
              const rawEvents = await this.provider.getContractEvents({
                address: contract.address,
                abi: contract.abi,
                fromBlock,
                toBlock,
                eventName,
              })

              logger.debug(
                {
                  contract: contract.name,
                  eventName,
                  count: rawEvents.length,
                  fromBlock: fromBlock.toString(),
                  toBlock: toBlock.toString(),
                },
                "📥 Fetched events",
              )

              return rawEvents.map((rawEvent) => this.parseEvent(rawEvent, contract))
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error)
              logger.warn(
                {
                  contract: contract.name,
                  eventName,
                  error: errorMessage,
                  fromBlock: fromBlock.toString(),
                  toBlock: toBlock.toString(),
                },
                "⚠️  Failed to fetch specific event, continuing...",
              )
              return []
            }
          }),
        )

        return allEventsByType.flat()
      }

      // Fallback: fetch all events from contract ABI (no filter)
      logger.debug(
        {
          contract: contract.name,
          fromBlock: fromBlock.toString(),
          toBlock: toBlock.toString(),
        },
        "📡 Fetching all events from contract (no specific event filter)",
      )

      const rawEvents = await this.provider.getContractEvents({
        address: contract.address,
        abi: contract.abi,
        fromBlock,
        toBlock,
      })

      const parsedEvents = rawEvents
        .map((rawEvent) => {
          try {
            return this.parseEvent(rawEvent, contract)
          } catch (error) {
            logger.warn(
              {
                contractName: contract.name,
                contractAddress: contract.address,
                blockNumber: rawEvent.blockNumber.toString(),
                logIndex: rawEvent.logIndex,
                error: error instanceof Error ? error.message : String(error),
              },
              "⚠️  Failed to parse event, skipping",
            )
            return null
          }
        })
        .filter((event): event is ParsedEvent => event !== null)

      logger.debug(
        {
          provider: this.provider.name,
          contract: contract.name,
          fromBlock: fromBlock.toString(),
          toBlock: toBlock.toString(),
          rawEvents: rawEvents.length,
          parsedEvents: parsedEvents.length,
        },
        "📄 Contract events parsed",
      )

      return parsedEvents
    } catch (error) {
      logger.error(
        {
          provider: this.provider.name,
          contract: contract.name,
          contractAddress: contract.address,
          fromBlock: fromBlock.toString(),
          toBlock: toBlock.toString(),
          error: error instanceof Error ? error.message : String(error),
        },
        "❌ Failed to fetch contract events",
      )

      // Re-throw to allow upper layers to handle (e.g., provider fallback)
      throw error
    }
  }

  /**
   * Parse a raw event into a typed ParsedEvent.
   * Decodes the event log using the contract's ABI.
   */
  private parseEvent(rawEvent: RawContractEvent, contract: ContractConfig): ParsedEvent {
    // Decode using viem
    const decoded = decodeEventLog({
      abi: contract.abi,
      data: rawEvent.data,
      topics: rawEvent.topics as [`0x${string}`, ...`0x${string}`[]],
    })

    return {
      contractName: contract.name,
      contractAddress: contract.address,
      eventName: decoded.eventName,
      args: decoded.args as Record<string, unknown>,
      blockNumber: rawEvent.blockNumber,
      blockTimestamp: Number(rawEvent.blockTimestamp || 0),
      transactionHash: rawEvent.transactionHash,
      logIndex: rawEvent.logIndex,
      raw: rawEvent,
    }
  }

  /**
   * Sort events chronologically: first by block number, then by log index.
   * This ensures events are processed in the order they occurred on-chain.
   */
  private sortEvents(events: ParsedEvent[]): ParsedEvent[] {
    return events.sort((a, b) => {
      // First compare block numbers
      const blockDiff = Number(a.blockNumber - b.blockNumber)
      if (blockDiff !== 0) return blockDiff

      // If same block, compare log indices
      return a.logIndex - b.logIndex
    })
  }

  /**
   * Update the provider (useful when switching between fast/archive providers)
   */
  setProvider(provider: IRpcProvider): void {
    this.provider = provider
    logger.debug({ provider: provider.name }, "🔄 Provider updated")
  }
}
