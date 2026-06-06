import type { Address } from "viem";

// ─────────────────────────────────────────────────────────────────────────────
// Contract addresses per chain
// This is the SINGLE SOURCE OF TRUTH for all deployed contract addresses.
// Both apps/web and apps/indexer must import from here.
// ─────────────────────────────────────────────────────────────────────────────

/** Sepolia testnet (chain ID 11155111) */
export const SEPOLIA_ADDRESSES = {
  MARKETPLACE: "0x55495153De44570DFC37B2daC4Bc13241B3C2e87" as Address,
  MARKETPLACE_BIDS: "0x613CeD51Fd25F67FEcc0c5C22981d42397eddFb1" as Address,
  MARKETPLACE_CORE: "0x36052B33e4f10E3264B89961EC3873374Fedc793" as Address,
} as const;

/** Address map keyed by chain ID */
export const CONTRACT_ADDRESSES: Record<number, typeof SEPOLIA_ADDRESSES> = {
  11155111: SEPOLIA_ADDRESSES,
};

// ─── Convenience named exports (current deployment: Sepolia) ─────────────────

export const MARKETPLACE_CONTRACT_ADDRESS = SEPOLIA_ADDRESSES.MARKETPLACE;
export const BIDS_CONTRACT_ADDRESS = SEPOLIA_ADDRESSES.MARKETPLACE_BIDS;
export const CORE_CONTRACT_ADDRESS = SEPOLIA_ADDRESSES.MARKETPLACE_CORE;
