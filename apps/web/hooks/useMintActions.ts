"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import { MockAbi } from "@/lib/abi"

export function useMint() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const mint = async (amount: number, address: `0x${string}`, to: `0x${string}`) => {
    const hash = await writeContractAsync({
      address,
      abi: MockAbi,
      functionName: "batchMint",
      args: [to, BigInt(amount)],
    })

    return hash
  }

  return { mint, publicClient }
}
