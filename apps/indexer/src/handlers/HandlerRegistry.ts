import type { IEventHandler } from "./IEventHandler"
import type { ParsedEvent } from "../types/indexer.types"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Central registry for event handlers.
 * Provides dynamic event dispatching based on contract name and event name.
 *
 * Usage:
 *   const registry = new HandlerRegistry()
 *   registry.register(new CoreEventHandler())
 *   registry.register(new BidsEventHandler())
 *   await registry.dispatch(parsedEvent)
 */
export class HandlerRegistry {
  private handlers: Map<string, IEventHandler>

  constructor() {
    this.handlers = new Map()
  }

  /**
   * Register an event handler.
   * Handlers are keyed by "contractName:eventName"
   */
  register(handler: IEventHandler): void {
    const key = this.getKey(handler.contractName, handler.eventName)
    this.handlers.set(key, handler)
    logger.debug({ key }, "📝 Handler registered")
  }

  /**
   * Register multiple handlers at once.
   */
  registerAll(handlers: IEventHandler[]): void {
    handlers.forEach((handler) => this.register(handler))
    logger.info({ count: handlers.length }, "📚 All handlers registered")
  }

  /**
   * Dispatch an event to the appropriate handler.
   * If no handler exists for the event, logs a warning.
   */
  async dispatch(event: ParsedEvent): Promise<void> {
    const key = this.getKey(event.contractName, event.eventName)
    const handler = this.handlers.get(key)

    if (!handler) {
      logger.warn(
        {
          contractName: event.contractName,
          eventName: event.eventName,
          blockNumber: event.blockNumber.toString(),
        },
        "⚠️  No handler registered for event",
      )
      return
    }

    try {
      await handler.handle(event)

      logger.debug(
        {
          contractName: event.contractName,
          eventName: event.eventName,
          blockNumber: event.blockNumber.toString(),
        },
        "✅ Event handled",
      )
    } catch (error) {
      logger.error(
        {
          contractName: event.contractName,
          eventName: event.eventName,
          blockNumber: event.blockNumber.toString(),
          transactionHash: event.transactionHash,
          error: error instanceof Error ? error.message : String(error),
        },
        "❌ Event handling failed",
      )

      // Re-throw to allow upper layers to decide (crash vs. skip)
      throw error
    }
  }

  /**
   * Dispatch multiple events in sequence.
   * Stops on first error unless continueOnError is true.
   */
  async dispatchAll(events: ParsedEvent[], continueOnError: boolean = false): Promise<void> {
    for (const event of events) {
      try {
        await this.dispatch(event)
      } catch (error) {
        if (!continueOnError) {
          throw error
        }
        // Error already logged in dispatch(), continue to next event
      }
    }
  }

  /**
   * Get the handler key for a contract and event name.
   */
  private getKey(contractName: string, eventName: string): string {
    return `${contractName}:${eventName}`
  }

  /**
   * Check if a handler is registered for a specific event.
   */
  hasHandler(contractName: string, eventName: string): boolean {
    return this.handlers.has(this.getKey(contractName, eventName))
  }

  /**
   * Get all registered handler keys.
   */
  getRegisteredHandlers(): string[] {
    return Array.from(this.handlers.keys())
  }
}
