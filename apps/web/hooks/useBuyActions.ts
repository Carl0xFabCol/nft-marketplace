"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import { MarketplaceABI } from "@/lib/abi"
import { MARKETPLACE_CONTRACT_ADDRESS } from "@/lib/constants"

export function useBuy() {
  const { writeContractAsync } = useWriteContract()

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

export function useBuyBatch() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

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
