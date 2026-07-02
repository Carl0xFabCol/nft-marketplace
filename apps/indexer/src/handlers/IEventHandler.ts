import type { ParsedEvent } from "../types/indexer.types"

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT HANDLER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Responsible for executing business logic in response to parsed blockchain events.
 * Handlers contain side effects (database writes, external API calls).
 *
 * IMPORTANT: Handlers must be stateless and independent of the execution context.
 * They should only depend on the parsed event data, making them queue-ready.
 */
export interface IEventHandler<TArgs = Record<string, unknown>> {
  /** Contract identifier (e.g., "core", "bids") */
  contractName: string

  /** Event name this handler processes (e.g., "ListingCreated") */
  eventName: string

  /**
   * Handle a parsed event by executing business logic.
   * @param event - Fully parsed event with decoded arguments
   * @returns Promise that resolves when handling is complete
   */
  handle(event: ParsedEvent<TArgs>): Promise<void>
}
