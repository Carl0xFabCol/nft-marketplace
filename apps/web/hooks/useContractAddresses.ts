"use client"

import { getContractAddresses } from "@marketplace/contracts"

/**
 * Contract addresses for an explicit chain (never the wallet's: pages pass the
 * data chain, see DATA_CHAIN_ID). For a chain without a deployment every
 * address is `undefined` and `supported` is false (ADDR-2: no fallback), so
 * reads stay disabled and writes are refused by useWriteGuard.
 */
export function useContractAddresses(chainId: number) {
  const addresses = getContractAddresses(chainId)

  return {
    supported: !!addresses,
    MARKETPLACE_CONTRACT_ADDRESS: addresses?.MARKETPLACE,
    BIDS_CONTRACT_ADDRESS: addresses?.MARKETPLACE_BIDS,
    CORE_CONTRACT_ADDRESS: addresses?.MARKETPLACE_CORE,
    LAUNCHPAD_CONTRACT_ADDRESS: addresses?.LAUNCHPAD,
  }
}
