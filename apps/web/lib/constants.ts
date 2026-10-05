// ─────────────────────────────────────────────────────────────────────────────
// Contract addresses — imported from the single source of truth.
// Do NOT hardcode these here. Edit packages/contracts/src/addresses.ts instead.
//
// NOTE: These are DEFAULT-CHAIN fallbacks only (used by non-hook/server contexts
// that can't call useChainId()). Client components should prefer the
// `useContractAddresses()` hook (apps/web/hooks/useContractAddresses.ts) so the
// correct addresses are used for whichever chain (Sepolia or Elysium) the
// connected wallet is on.
// ─────────────────────────────────────────────────────────────────────────────
export { MARKETPLACE_CONTRACT_ADDRESS, BIDS_CONTRACT_ADDRESS, CORE_CONTRACT_ADDRESS } from "@marketplace/contracts"

// ─────────────────────────────────────────────────────────────────────────────
// Local UI-layer types.
// ─────────────────────────────────────────────────────────────────────────────

export type SortBy = "id" | "price"
export type SortDir = "asc" | "desc"
