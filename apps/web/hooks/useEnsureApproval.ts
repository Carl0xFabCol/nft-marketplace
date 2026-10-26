"use client"

import { usePublicClient, useWriteContract } from "wagmi"
import { erc721Abi, type Address } from "viem"
import { useContractAddresses } from "@/hooks/useContractAddresses"
import { useTx } from "@/app/context/TxContext"
import { waitForTxConfirmation } from "@/lib/tx"

export function useEnsureApproval() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const { CORE_CONTRACT_ADDRESS } = useContractAddresses()
  const { addTx, updateTx, removeTx } = useTx()

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

    addTx({ hash, status: "loading", label: "Approving collection..." })

    try {
      await waitForTxConfirmation(publicClient, hash)
      updateTx(hash, { status: "success", label: "Collection approved!" })
      setTimeout(() => removeTx(hash), 5000)
    } catch (error) {
      updateTx(hash, { status: "error", label: "Approval failed" })
      setTimeout(() => removeTx(hash), 6000)
      throw error
    }

    return hash
  }

  return { ensureApproval }
}
