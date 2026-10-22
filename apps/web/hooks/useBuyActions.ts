"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import type { PublicClient } from "viem"
import { MarketplaceABI } from "@/lib/abi"
import { useContractAddresses } from "@/hooks/useContractAddresses"

export function useBuy() {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const buy = async (collection: `0x${string}`, tokenId: bigint, value: bigint) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "buy",
      args: [collection, tokenId],
      value,
    })
    return txHash
  }

  return { buy }
}

export interface UseBuyBatchResult {
  buyBatch: (collection: `0x${string}`, tokenIds: bigint[], value: bigint) => Promise<`0x${string}`>
  publicClient: PublicClient | undefined
}

export function useBuyBatch(): UseBuyBatchResult {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const buyBatch = async (_collection: `0x${string}`, _tokenIds: bigint[], value: bigint) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "buyBatch",
      args: [_collection, _tokenIds],
      value,
    })
    return txHash
  }

  return { buyBatch, publicClient }
}
