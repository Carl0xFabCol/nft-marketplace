"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import type { PublicClient } from "viem"
import { MarketplaceABI } from "@/lib/abi"
import { useContractAddresses } from "@/hooks/useContractAddresses"

export interface UseRegisterCollectionResult {
  registerCollection: (
    collection: `0x${string}`,
    royaltyFee: bigint,
    receiver: `0x${string}`,
  ) => Promise<`0x${string}`>
  publicClient: PublicClient | undefined
}

export function useRegisterCollection(): UseRegisterCollectionResult {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const registerCollection = async (collection: `0x${string}`, royaltyFee: bigint, receiver: `0x${string}`) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "registerCollection",
      args: [collection, Number(royaltyFee), receiver],
    })
    return txHash
  }

  return { registerCollection, publicClient }
}
