// lib/chainGuard.ts
//
// Explicit chain selection for pages that already know their target chain.
// `useChainId()` is the wallet's current chain (and falls back to the first
// configured chain while disconnected), so it must never decide which chain a
// page's data belongs to. Pages pass the server-resolved chain ID down; these
// helpers fail closed before any chain-dependent write.

import { getContractAddresses, type ContractAddresses } from "@marketplace/contracts"
import { DEFAULT_CHAIN_ID } from "@marketplace/shared"
import { SUPPORTED_CHAIN_IDS } from "@/lib/chains"

const CHAIN_LABELS: Record<number, string> = {
  11155111: "Sepolia",
  99801: "Elysium Testnet",
}

export class ChainGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ChainGuardError"
  }
}

export function isSupportedChainId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && SUPPORTED_CHAIN_IDS.includes(value)
}

export function requireSupportedChainId(value: unknown): number {
  if (!isSupportedChainId(value)) {
    throw new ChainGuardError("This page is configured with an unsupported chain.")
  }
  return value
}

export function chainLabel(chainId: number): string {
  return CHAIN_LABELS[chainId] ?? `chain ${chainId}`
}

/**
 * Assert that the wallet is connected to the page's target chain. Call this
 * immediately before submitting a chain-dependent write. Disconnected wallets
 * may browse, but cannot write.
 */
export function assertWalletChain(connectedChainId: number | null | undefined, targetChainId: number): number {
  const target = requireSupportedChainId(targetChainId)

  if (typeof connectedChainId !== "number" || !Number.isInteger(connectedChainId) || connectedChainId <= 0) {
    throw new ChainGuardError(`Connect a wallet on ${chainLabel(target)} to continue.`)
  }

  if (connectedChainId !== target) {
    throw new ChainGuardError(`Wrong network: switch your wallet to ${chainLabel(target)} (${target}) to continue.`)
  }

  return target
}

/** Returns a safe, user-facing message for chain guard failures. */
export function chainGuardErrorMessage(error: unknown): string | null {
  if (error instanceof ChainGuardError) return error.message
  return null
}

/**
 * The ONE chain whose data the app shows (reads, realtime, pagination) and
 * whose contracts it writes to. Never derived from the wallet: a wallet on
 * another chain sees "switch network", not another chain's data/contracts.
 */
export const DATA_CHAIN_ID: number = requireSupportedChainId(DEFAULT_CHAIN_ID)

/** The chain's marketplace contracts, or a ChainGuardError (ADDR-2: no fallback). */
export function requireChainContracts(chainId: number): ContractAddresses {
  const addresses = getContractAddresses(chainId)
  if (!addresses) {
    throw new ChainGuardError(`The marketplace is not deployed on ${chainLabel(chainId)}. Switch to ${chainLabel(DATA_CHAIN_ID)}.`)
  }
  return addresses
}

/**
 * Gate for every contract write: the wallet must be connected to `targetChainId`
 * and that chain must have marketplace contracts. Returns the addresses to use.
 */
export function assertWriteTarget(connectedChainId: number | null | undefined, targetChainId: number): ContractAddresses {
  const target = assertWalletChain(connectedChainId, targetChainId)
  return requireChainContracts(target)
}
