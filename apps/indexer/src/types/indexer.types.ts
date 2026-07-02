import type { Address, Log } from "viem"

// ═══════════════════════════════════════════════════════════════════════════════
// CORE EVENT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface RawContractEvent {
  blockTimestamp?: bigint
  transactionHash: `0x${string}`
  logIndex: number
  blockNumber: bigint
  address: Address
  topics: readonly `0x${string}`[]
  data: `0x${string}`
}

export interface ParsedEvent<TArgs = Record<string, unknown>> {
  contractName: string
  contractAddress: Address
  eventName: string
  args: TArgs
  blockNumber: bigint
  blockTimestamp: number
  transactionHash: `0x${string}`
  logIndex: number
  raw: RawContractEvent
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRACT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface ContractConfig {
  name: string
  address: Address
  abi: readonly unknown[]
  events: readonly string[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK RANGE
// ═══════════════════════════════════════════════════════════════════════════════

export interface BlockRange {
  from: bigint
  to: bigint
}

// ═══════════════════════════════════════════════════════════════════════════════
// RPC PROVIDER TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type RpcProviderType = "archive" | "fast"

export interface RpcProviderConfig {
  name: string
  url: string
  type: RpcProviderType
  headers?: Record<string, string>
}

export interface GetContractEventsParams {
  address: Address
  abi: readonly unknown[]
  fromBlock: bigint
  toBlock: bigint
  eventName?: string
}

export interface ReadContractParams {
  address: Address
  abi: readonly unknown[]
  functionName: string
  args?: readonly unknown[]
}
