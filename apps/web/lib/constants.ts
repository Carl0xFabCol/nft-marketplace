// ─────────────────────────────────────────────────────────────────────────────
// Contract addresses — imported from the single source of truth.
// Do NOT hardcode these here. Edit packages/contracts/src/addresses.ts instead.
// ─────────────────────────────────────────────────────────────────────────────
export {
  MARKETPLACE_CONTRACT_ADDRESS,
  BIDS_CONTRACT_ADDRESS,
  CORE_CONTRACT_ADDRESS,
} from "@marketplace/contracts";

// ─────────────────────────────────────────────────────────────────────────────
// Local UI-layer types.
// ─────────────────────────────────────────────────────────────────────────────

export type SortBy = "id" | "price";
export type SortDir = "asc" | "desc";
