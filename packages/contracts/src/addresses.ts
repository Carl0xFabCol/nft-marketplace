import type { Address } from "viem"

// ─────────────────────────────────────────────────────────────────────────────
// Contract addresses per chain
// This is the SINGLE SOURCE OF TRUTH for all deployed contract addresses.
// Both apps/web and apps/indexer must import from here.
// ─────────────────────────────────────────────────────────────────────────────

/** Sepolia testnet (chain ID 11155111) */
export const SEPOLIA_ADDRESSES = {
  MARKETPLACE: "0x880176caEd2C38F889e5E0AD6Ae55A871dd0f3B5" as Address,
  MARKETPLACE_BIDS: "0x66759517050c84A1AC239C4D37FfB7A2de05F37f" as Address,
  MARKETPLACE_CORE: "0x80D414fAD89E471E46c97B66F2B567e1b970A5C0" as Address,
} as const

/** Address map keyed by chain ID */
export const CONTRACT_ADDRESSES: Record<number, typeof SEPOLIA_ADDRESSES> = {
  11155111: SEPOLIA_ADDRESSES,
}

// ─── Convenience named exports (current deployment: Sepolia) ─────────────────

export const MARKETPLACE_CONTRACT_ADDRESS = SEPOLIA_ADDRESSES.MARKETPLACE
export const BIDS_CONTRACT_ADDRESS = SEPOLIA_ADDRESSES.MARKETPLACE_BIDS
export const CORE_CONTRACT_ADDRESS = SEPOLIA_ADDRESSES.MARKETPLACE_CORE
