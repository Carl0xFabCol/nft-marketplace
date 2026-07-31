"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import { MarketplaceABI } from "@/lib/abi"
import { MARKETPLACE_CONTRACT_ADDRESS } from "@/lib/constants"

export function useCancelList() {
  const { writeContractAsync } = useWriteContract()

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

export function useCancelListBatch() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

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
