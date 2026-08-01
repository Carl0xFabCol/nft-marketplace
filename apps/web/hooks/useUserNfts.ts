// hooks/useUserNfts.ts
import { useState, useMemo, useEffect } from "react"
import { Address } from "viem"
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi"
import { erc721Abi } from "viem"
import { EnrichedUserNFT, Collection, UserNFT } from "@/types/user.types"
import { CORE_CONTRACT_ADDRESS } from "@/lib/constants"
import { useTx } from "@/app/context/TxContext"
import { UseBatchOperationsReturn } from "./useBatchOperations"
import { useCancelListBatch } from "./useListingActions"

interface UseUserNftsParams {
  nfts: EnrichedUserNFT[]
  collections: Collection[]
  batchOps: UseBatchOperationsReturn
  userAddress: Address
  /** Called right after the delist tx is sent — optimistic local patch. */
  onDelist?: (items: UserNFT[]) => void
  /** Called when the delist tx fails — restore the optimistic patch. */
  onDelistFail?: (items: UserNFT[]) => void
}

export function useUserNfts({ nfts, collections, batchOps, userAddress, onDelist, onDelistFail }: UseUserNftsParams) {
  const publicClient = usePublicClient()

  const { writeContractAsync } = useWriteContract()
  const { cancelListBatch } = useCancelListBatch()
  const { address } = useAccount()
  const [approvalMap, setApprovalMap] = useState<Map<string, boolean>>(new Map())

  const { listTokensBatch, delistBatch, approveBatch, clearBatch } = batchOps
  const { addTx, removeTx, updateTx } = useTx()

  // Collect the unique collection addresses
  const uniqueCollections = useMemo(() => {
    const addresses = new Set<string>()
    nfts.forEach((nft) => addresses.add(nft.collection_address.toLowerCase()))
    return Array.from(addresses)
  }, [nfts])

  // Check approvals for each collection
  const { data: approvals } = useReadContracts({
    contracts: uniqueCollections.map((collectionAddress) => ({
      address: collectionAddress as Address,
      abi: erc721Abi,
      functionName: "isApprovedForAll",
      args: [userAddress, CORE_CONTRACT_ADDRESS],
    })),
    query: {
      enabled: uniqueCollections.length > 0 && address?.toLowerCase() === userAddress.toLowerCase(),
    },
  })

  // Update the approvals map
  useEffect(() => {
    if (!approvals) return

    const newApprovalMap = new Map()
    approvals.forEach((result: any, index: number) => {
      if (result.status === "success") {
        newApprovalMap.set(uniqueCollections[index], result.result)
      }
    })
    setApprovalMap(newApprovalMap)
  }, [approvals, uniqueCollections])

  // Check that every collection in the approve batch is approved
  const allApproved = useMemo(() => {
    const collectionsToApprove = new Set(approveBatch.map((item: any) => item.toLowerCase()))
    for (const collection of collectionsToApprove) {
      if (!approvalMap.get(collection as string)) {
        return false
      }
    }
    return true
  }, [approveBatch, approvalMap])

  // Handler for delisting
  const handleDelist = async () => {
    const items = delistBatch
    if (!items.length) return

    const collectionAddresses = items.map((i) => i.collection_address as Address)
    const tokenIds = items.map((i) => BigInt(i.token_id))

    try {
      const hash = await cancelListBatch(collectionAddresses, tokenIds)

      addTx({ hash, status: "loading", label: `Delisting ${items.length} items...` })

      // Optimistic local patch: the items stop rendering as listed immediately;
      // the indexer + realtime reconcile the DB `is_active = false`.
      onDelist?.(items)

      await publicClient?.waitForTransactionReceipt({ hash })
      updateTx(hash, { status: "success", label: "Delisted!" })
      setTimeout(() => removeTx(hash), 3000)

      clearBatch("delist")
    } catch (err) {
      console.error("Delist error:", err)
      const hash = (err as any)?.hash
      if (hash) {
        updateTx(hash, { status: "error", label: "Delist failed" })
        setTimeout(() => removeTx(hash), 5000)
      }
      // Restore the optimistic patch so items don't stay visually unlisted.
      onDelistFail?.(items)
    }
  }

  // Handler for approving a collection
  const approveCollection = async (collectionAddress: Address) => {
    // Approve the marketplace to transfer all tokens of this collection.
    let txHash = ""
    try {
      const txHash = await writeContractAsync({
        address: collectionAddress,
        abi: erc721Abi,
        functionName: "setApprovalForAll",
        args: [CORE_CONTRACT_ADDRESS, true],
      })

      addTx({ hash: txHash, label: "Approving collection", status: "loading" })

      await publicClient?.waitForTransactionReceipt({ hash: txHash })
      updateTx(txHash, { label: "Approving collection", status: "success" })
      removeTx(txHash as `0x${string}`)
      clearBatch("approve")
    } catch (e) {
      updateTx(txHash, { label: "Transaction reverted!", status: "error" })
      removeTx(txHash as `0x${string}`)
    }
  }

  return {
    approvalMap,
    allApproved,
    handleDelist,
    approveCollection,
  }
}
