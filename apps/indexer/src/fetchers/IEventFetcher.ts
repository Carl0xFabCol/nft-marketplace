import type { ContractConfig, ParsedEvent } from "../types/indexer.types"

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT FETCHER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Responsible for fetching and aggregating contract events across block ranges.
 * Implements batching, parallelization, and block range chunking.
 */
export interface IEventFetcher {
  /**
   * Fetch all events from multiple contracts within a block range.
   * @param contracts - Array of contract configurations to index
   * @param fromBlock - Starting block (inclusive)
   * @param toBlock - Ending block (inclusive)
   * @returns Array of parsed events, sorted by block number and log index
   */
  fetchEventsInRange(contracts: ContractConfig[], fromBlock: bigint, toBlock: bigint): Promise<ParsedEvent[]>
}
