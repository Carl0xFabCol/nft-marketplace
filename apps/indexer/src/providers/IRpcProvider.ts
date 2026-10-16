import type { Address } from "viem"
import type { GetContractEventsParams, ReadContractParams, RawContractEvent, RpcProviderType } from "../types/indexer.types"

// ═══════════════════════════════════════════════════════════════════════════════
// RPC PROVIDER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Abstraction layer for RPC providers.
 * Allows swapping between different providers (Viem, Ethers, Alchemy SDK)
 * and implementing fallback/retry logic.
 */
export interface IRpcProvider {
  /** Provider identifier (e.g., "alchemy-archive", "publicnode-fast") */
  name: string

  /** Provider type: archive (historical) or fast (recent blocks) */
  type: RpcProviderType

  /** Get the latest block number */
  getBlockNumber(): Promise<bigint>

  /** Get the chain id reported by the RPC endpoint (used to reject misconfigured URLs) */
  getChainId(): Promise<number>

  /** Fetch contract events within a block range */
  getContractEvents(params: GetContractEventsParams): Promise<RawContractEvent[]>

  /** Read data from a contract (e.g., tokenURI, name, symbol) */
  readContract<T = unknown>(params: ReadContractParams): Promise<T>

  /** Health check - verifies provider is responding */
  isHealthy(): Promise<boolean>
}
