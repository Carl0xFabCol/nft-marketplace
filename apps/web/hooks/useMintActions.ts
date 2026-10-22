"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import type { PublicClient } from "viem"
import { MiColeccionABI } from "@/lib/abi"

export interface UseMintResult {
  mint: (amount: number, address: `0x${string}`, to: `0x${string}`, value: bigint) => Promise<`0x${string}`>
  publicClient: PublicClient | undefined
}

export function useMint(): UseMintResult {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const mint = async (amount: number, address: `0x${string}`, to: `0x${string}`, value: bigint) => {
    const hash = await writeContractAsync({
      address,
      abi: MiColeccionABI,
      functionName: "batchMint",
      args: [to, BigInt(amount)],
      value,
    })

    return hash
  }

  return { mint, publicClient }
}
