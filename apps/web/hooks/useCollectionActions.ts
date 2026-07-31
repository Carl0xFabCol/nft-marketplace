"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import { MarketplaceABI } from "@/lib/abi"
import { MARKETPLACE_CONTRACT_ADDRESS } from "@/lib/constants"

export function useRegisterCollection() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

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
