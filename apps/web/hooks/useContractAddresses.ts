"use client"

import { useChainId } from "wagmi"
import { getContractAddresses } from "@marketplace/contracts"

/**
 * Returns the marketplace contract addresses for an explicit chain, or for the
 * wallet's current chain when no chain is passed (legacy callers). Pages should
 * always pass their server-resolved chain so wallet state cannot change the
 * target contract addresses.
 */
export function useContractAddresses(chainId?: number) {
  const connectedChainId = useChainId()
  const addresses = getContractAddresses(chainId ?? connectedChainId)

  return {
    MARKETPLACE_CONTRACT_ADDRESS: addresses.MARKETPLACE,
    BIDS_CONTRACT_ADDRESS: addresses.MARKETPLACE_BIDS,
    CORE_CONTRACT_ADDRESS: addresses.MARKETPLACE_CORE,
    LAUNCHPAD_CONTRACT_ADDRESS: addresses.LAUNCHPAD,
  }
}
