"use client"

import { usePublicClient, useWriteContract } from "wagmi"
import { erc721Abi, type Address } from "viem"
import { useWriteGuard } from "@/hooks/useWriteGuard"
import { useTx } from "@/app/context/TxContext"
import { waitForTxConfirmation } from "@/lib/tx"

export function useEnsureApproval(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId })
  const guardWrite = useWriteGuard(chainId)
  const { addTx, updateTx, removeTx } = useTx()

  const ensureApproval = async (collection: Address, owner: Address): Promise<`0x${string}` | null> => {
    if (!publicClient) throw new Error("Public client is not available")
    // Approval is a write on this chain: same gate as the sale it precedes.
    const { MARKETPLACE_CORE: CORE_CONTRACT_ADDRESS } = guardWrite()

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
      chainId,
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
