"use client"

import { usePublicClient, useWriteContract } from "wagmi"
import { erc721Abi, type Address } from "viem"
import { useContractAddresses } from "@/hooks/useContractAddresses"

export function useEnsureApproval() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const { CORE_CONTRACT_ADDRESS } = useContractAddresses()

  const ensureApproval = async (collection: Address, owner: Address): Promise<`0x${string}` | null> => {
    if (!publicClient) throw new Error("Public client is not available")

    const approved = await publicClient.readContract({
      address: collection,
      abi: erc721Abi,
      functionName: "isApprovedForAll",
      args: [owner, CORE_CONTRACT_ADDRESS],
    })

    if (approved) return null

    const hash = await writeContractAsync({
      address: collection,
      abi: erc721Abi,
      functionName: "setApprovalForAll",
      args: [CORE_CONTRACT_ADDRESS, true],
    })

    await publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  return { ensureApproval }
}
