"use client"

import { DEFAULT_SLIPPAGE_BPS } from "@/lib/bidAcceptance"

/**
 * The ONE place the bid-acceptance slippage tolerance comes from (basis points,
 * bigint). Today: 0, i.e. minPrice = the bid price shown and minSellerProceeds =
 * the proceeds shown (product decision 2026-11-08).
 *
 * A future UI selector replaces this body (e.g. a context or persisted
 * setting); the accept hooks already read it from here and need no change.
 */
export function useSlippageBps(): bigint {
  return DEFAULT_SLIPPAGE_BPS
}
