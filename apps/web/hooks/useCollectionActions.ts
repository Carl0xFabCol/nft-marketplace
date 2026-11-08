"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import type { PublicClient } from "viem"
import { MarketplaceABI } from "@/lib/abi"
import { useWriteGuard } from "@/hooks/useWriteGuard"

export interface UseRegisterCollectionResult {
  registerCollection: (
    collection: `0x${string}`,
    royaltyFee: bigint,
    receiver: `0x${string}`,
  ) => Promise<`0x${string}`>
  publicClient: PublicClient | undefined
}

export function useRegisterCollection(chainId: number): UseRegisterCollectionResult {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId })
  const guardWrite = useWriteGuard(chainId)

  const registerCollection = async (collection: `0x${string}`, royaltyFee: bigint, receiver: `0x${string}`) => {
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
      abi: MarketplaceABI,
      functionName: "registerCollection",
      args: [collection, Number(royaltyFee), receiver],
      chainId,
    })
    return txHash
  }

  return { registerCollection, publicClient }
}
