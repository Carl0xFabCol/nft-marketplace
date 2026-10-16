"use client"

import { useChainId } from "wagmi"
import { getContractAddresses } from "@marketplace/contracts"

/**
 * Returns the marketplace contract addresses for whichever chain the wallet
 * is currently connected to (Sepolia or Elysium). Falls back to the default
 * chain's addresses if not connected yet / connected to an unsupported chain.
 */
export function useContractAddresses() {
  const chainId = useChainId()
  const addresses = getContractAddresses(chainId)

  return {
    MARKETPLACE_CONTRACT_ADDRESS: addresses.MARKETPLACE,
    BIDS_CONTRACT_ADDRESS: addresses.MARKETPLACE_BIDS,
    CORE_CONTRACT_ADDRESS: addresses.MARKETPLACE_CORE,
    LAUNCHPAD_CONTRACT_ADDRESS: addresses.LAUNCHPAD,
  }
}
