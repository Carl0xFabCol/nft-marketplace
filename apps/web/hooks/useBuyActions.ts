"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import type { PublicClient } from "viem"
import { MarketplaceABI } from "@/lib/abi"
import { useWriteGuard } from "@/hooks/useWriteGuard"

export function useBuy(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const guardWrite = useWriteGuard(chainId)

  const buy = async (collection: `0x${string}`, tokenId: bigint, value: bigint) => {
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
      abi: MarketplaceABI,
      functionName: "buy",
      args: [collection, tokenId],
      value,
      chainId,
    })
    return txHash
  }

  return { buy }
}

export interface UseBuyBatchResult {
  buyBatch: (collection: `0x${string}`, tokenIds: bigint[], value: bigint) => Promise<`0x${string}`>
  publicClient: PublicClient | undefined
}

export function useBuyBatch(chainId: number): UseBuyBatchResult {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId })
  const guardWrite = useWriteGuard(chainId)

  const buyBatch = async (_collection: `0x${string}`, _tokenIds: bigint[], value: bigint) => {
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
      abi: MarketplaceABI,
      functionName: "buyBatch",
      args: [_collection, _tokenIds],
      value,
      chainId,
    })
    return txHash
  }

  return { buyBatch, publicClient }
}
