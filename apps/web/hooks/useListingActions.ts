"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import type { PublicClient } from "viem"
import { MarketplaceABI } from "@/lib/abi"
import { useWriteGuard } from "@/hooks/useWriteGuard"

export function useCancelList(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const guardWrite = useWriteGuard(chainId)

  const cancelList = async (collection: `0x${string}`, tokenId: number) => {
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
      abi: MarketplaceABI,
      functionName: "cancelListing",
      args: [collection, BigInt(tokenId)],
      chainId,
    })
    return txHash
  }

  return { cancelList }
}

export interface UseCancelListBatchResult {
  cancelListBatch: (collections: `0x${string}`[], tokenIds: bigint[]) => Promise<`0x${string}`>
  publicClient: PublicClient | undefined
}

export function useCancelListBatch(chainId: number): UseCancelListBatchResult {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId })
  const guardWrite = useWriteGuard(chainId)

  const cancelListBatch = async (_collections: `0x${string}`[], _tokenIds: bigint[]) => {
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
      abi: MarketplaceABI,
      functionName: "cancelListingBatch",
      args: [_collections, _tokenIds],
      chainId,
    })
    return txHash
  }

  return { cancelListBatch, publicClient }
}
