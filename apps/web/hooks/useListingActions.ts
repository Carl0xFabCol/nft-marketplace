"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import type { PublicClient } from "viem"
import { MarketplaceABI } from "@/lib/abi"
import { useContractAddresses } from "@/hooks/useContractAddresses"

export function useCancelList() {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const cancelList = async (collection: `0x${string}`, tokenId: number) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "cancelListing",
      args: [collection, BigInt(tokenId)],
    })
    return txHash
  }

  return { cancelList }
}

export interface UseCancelListBatchResult {
  cancelListBatch: (collections: `0x${string}`[], tokenIds: bigint[]) => Promise<`0x${string}`>
  publicClient: PublicClient | undefined
}

export function useCancelListBatch(): UseCancelListBatchResult {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const cancelListBatch = async (_collections: `0x${string}`[], _tokenIds: bigint[]) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "cancelListingBatch",
      args: [_collections, _tokenIds],
    })
    return txHash
  }

  return { cancelListBatch, publicClient }
}
