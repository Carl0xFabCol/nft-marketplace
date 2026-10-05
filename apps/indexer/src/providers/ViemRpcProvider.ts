import { createPublicClient, http, type Chain, type PublicClient } from "viem"
import type { IRpcProvider } from "./IRpcProvider"
import type { GetContractEventsParams, RawContractEvent, ReadContractParams, RpcProviderType } from "../types/indexer.types"
import { logger } from "../utils/logger"
import { getViemChain } from "./chains"

// ═══════════════════════════════════════════════════════════════════════════════
// VIEM RPC PROVIDER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Concrete implementation of IRpcProvider using Viem.
 * Wraps a Viem PublicClient to provide a standardized interface.
 */
export class ViemRpcProvider implements IRpcProvider {
  public readonly name: string
  public readonly type: RpcProviderType
  private client: PublicClient

  constructor(config: { name: string; url: string; type: RpcProviderType; headers?: Record<string, string>; chainId?: number; chain?: Chain }) {
    this.name = config.name
    this.type = config.type

    // Create viem client with optional custom headers (e.g., for authentication)
    this.client = createPublicClient({
      chain: config.chain ?? getViemChain(config.chainId ?? 11155111),
      transport: http(config.url, {
        timeout: 30_000, // 30s timeout
        ...(config.headers && {
          fetchOptions: {
            headers: config.headers,
          },
        }),
      }),
    })

    logger.debug({ name: this.name, url: config.url, type: this.type }, "🔌 RPC Provider initialized")
  }

  async getBlockNumber(): Promise<bigint> {
    try {
      const blockNumber = await this.client.getBlockNumber()
      logger.debug({ provider: this.name, blockNumber: blockNumber.toString() }, "📊 Block number fetched")
      return blockNumber
    } catch (error) {
      logger.error({ provider: this.name, error: error instanceof Error ? error.message : String(error) }, "❌ Failed to get block number")
      throw error
    }
  }

  async getContractEvents(params: GetContractEventsParams): Promise<RawContractEvent[]> {
    const { address, abi, fromBlock, toBlock, eventName } = params

    try {
      const startTime = Date.now()

      const events = await this.client.getContractEvents({
        address,
        abi,
        fromBlock,
        toBlock,
        ...(eventName && { eventName }),
      })

      const duration = Date.now() - startTime

      logger.debug(
        {
          provider: this.name,
          address,
          fromBlock: fromBlock.toString(),
          toBlock: toBlock.toString(),
          eventName: eventName || "all",
          count: events.length,
          durationMs: duration,
        },
        "📥 Contract events fetched",
      )

      // Cast to our RawContractEvent type
      return events as RawContractEvent[]
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Check if this is an archive access error
      const isArchiveError =
        errorMessage.toLowerCase().includes("missing trie node") ||
        errorMessage.toLowerCase().includes("header not found") ||
        errorMessage.toLowerCase().includes("block not available") ||
        errorMessage.toLowerCase().includes("archive") ||
        errorMessage.toLowerCase().includes("pruned")

      if (isArchiveError) {
        logger.warn(
          {
            provider: this.name,
            address,
            fromBlock: fromBlock.toString(),
            toBlock: toBlock.toString(),
            error: errorMessage,
          },
          "⚠️  Archive node required for this block range",
        )
      } else {
        logger.error(
          {
            provider: this.name,
            address,
            fromBlock: fromBlock.toString(),
            toBlock: toBlock.toString(),
            error: errorMessage,
          },
          "❌ Failed to fetch contract events",
        )
      }

      throw error
    }
  }

  async readContract<T = unknown>(params: ReadContractParams): Promise<T> {
    const { address, abi, functionName, args } = params

    try {
      const result = await this.client.readContract({
        address,
        abi,
        functionName,
        args,
      })

      logger.debug({ provider: this.name, address, functionName }, "📖 Contract read successful")

      return result as T
    } catch (error) {
      logger.error(
        {
          provider: this.name,
          address,
          functionName,
          error: error instanceof Error ? error.message : String(error),
        },
        "❌ Failed to read contract",
      )
      throw error
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.getBlockNumber()
      return true
    } catch (error) {
      logger.warn({ provider: this.name, error: error instanceof Error ? error.message : String(error) }, "⚠️  Provider health check failed")
      return false
    }
  }
}
