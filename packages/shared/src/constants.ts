// ─────────────────────────────────────────────────────────────────────────────
// Shared constants used across apps/web and apps/indexer.
// NEVER duplicate these — import from "@marketplace/shared/constants" instead.
// ─────────────────────────────────────────────────────────────────────────────

/** Supported chain IDs */
export const CHAIN_IDS = {
  SEPOLIA: 11155111,
  MAINNET: 1,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

/** The chain the marketplace is currently deployed on */
export const DEFAULT_CHAIN_ID: ChainId = CHAIN_IDS.SEPOLIA;

/** ERC721 zero address — used to filter burned/null tokens */
export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;
