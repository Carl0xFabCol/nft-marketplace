import type { ContractConfig, ContractFetchRequest, ParsedEvent } from "../types/indexer.types"

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

  /**
   * Fetch events from multiple contracts, each with its own fromBlock.
   * Allows dynamically-registered collection contracts to start from
   * their deployment block independently of the global indexer state.
   * @param requests - Array of contract configs paired with their fromBlock
   * @param toBlock - Ending block (inclusive)
   * @returns Array of parsed events, sorted by block number and log index
   */
  fetchEventsForContracts(requests: ContractFetchRequest[], toBlock: bigint): Promise<ParsedEvent[]>
}
