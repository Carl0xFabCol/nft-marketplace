import type { ParsedEvent, RawContractEvent } from "../types/indexer.types"

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT PARSER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Responsible for decoding raw blockchain logs into typed, parsed events.
 * Parsers are pure functions with no side effects.
 */
export interface IEventParser<TArgs = Record<string, unknown>> {
  /** Contract identifier (e.g., "core", "bids") */
  contractName: string

  /** Event name this parser handles (e.g., "ListingCreated") */
  eventName: string

  /**
   * Parse a raw contract event into a structured format.
   * @param rawEvent - Raw log from the blockchain
   * @returns Parsed event with decoded arguments
   */
  parse(rawEvent: RawContractEvent): ParsedEvent<TArgs>
}
