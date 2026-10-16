import type { Address } from "viem"

// ─────────────────────────────────────────────────────────────────────────────
// Contract addresses per chain
// This is the SINGLE SOURCE OF TRUTH for all deployed contract addresses.
// Both apps/web and apps/indexer must import from here.
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of the per-chain contract address map. `LAUNCHPAD` is optional because it is only deployed on chains that run the factory. */
export type ContractAddresses = {
  readonly MARKETPLACE: Address
  readonly MARKETPLACE_BIDS: Address
  readonly MARKETPLACE_CORE: Address
  readonly LAUNCHPAD?: Address
}

/** Sepolia testnet (chain ID 11155111) */
export const SEPOLIA_ADDRESSES: ContractAddresses = {
  MARKETPLACE: "0x880176caEd2C38F889e5E0AD6Ae55A871dd0f3B5" as Address,
  MARKETPLACE_BIDS: "0x66759517050c84A1AC239C4D37FfB7A2de05F37f" as Address,
  MARKETPLACE_CORE: "0x80D414fAD89E471E46c97B66F2B567e1b970A5C0" as Address,
}

/** Elysium (chain ID 99801) */
export const ELYSIUM_ADDRESSES: ContractAddresses = {
  MARKETPLACE: "0xF26E73d620251752782B351424D5EC749c5007e9" as Address,
  MARKETPLACE_BIDS: "0xc2f7357E0f66CBdb7E52f6D9787eFc13Eb3669Df" as Address,
  MARKETPLACE_CORE: "0x8dDbd93EaD1766a1Fe98DE55D68a7B8529B5f079" as Address,
  LAUNCHPAD: "0x3613128fAA9f1bb8DF769D60ad5CfbBc85C59d54" as Address,
}

/** Address map keyed by chain ID */
export const CONTRACT_ADDRESSES: Record<number, ContractAddresses> = {
  11155111: SEPOLIA_ADDRESSES,
  99801: ELYSIUM_ADDRESSES,
}

/** Chain ID used when no explicit chainId is provided to address lookups. */
export const DEFAULT_ADDRESSES_CHAIN_ID = 99801 // Elysium

/**
 * Resolve the deployed contract addresses for a given chain id.
 * Falls back to DEFAULT_ADDRESSES_CHAIN_ID's addresses if the chain id is
 * not recognized (with a console warning), so callers never get `undefined`.
 */
export function getContractAddresses(chainId?: number): ContractAddresses {
  const resolvedChainId = chainId ?? DEFAULT_ADDRESSES_CHAIN_ID
  const addresses = CONTRACT_ADDRESSES[resolvedChainId]

  if (!addresses) {
    console.warn(`⚠️ No contract addresses configured for chainId ${resolvedChainId}. Falling back to default.`)
    return CONTRACT_ADDRESSES[DEFAULT_ADDRESSES_CHAIN_ID]
  }

  return addresses
}

// ─── Convenience named exports (backward-compatible, default deployment: Elysium) ─
// NEW consumers should prefer `getContractAddresses(chainId)` so both Sepolia and
// Elysium are correctly supported side-by-side. These singletons remain for any
// code that hasn't been updated yet and always resolve to the default chain.

export const MARKETPLACE_CONTRACT_ADDRESS = ELYSIUM_ADDRESSES.MARKETPLACE
export const BIDS_CONTRACT_ADDRESS = ELYSIUM_ADDRESSES.MARKETPLACE_BIDS
export const CORE_CONTRACT_ADDRESS = ELYSIUM_ADDRESSES.MARKETPLACE_CORE
export const LAUNCHPAD_CONTRACT_ADDRESS = ELYSIUM_ADDRESSES.LAUNCHPAD
