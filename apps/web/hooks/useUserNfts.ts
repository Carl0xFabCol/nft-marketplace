// hooks/useUserNfts.ts
import { useState, useMemo, useEffect } from "react"
import { Address } from "viem"
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi"
import { erc721Abi } from "viem"
import { EnrichedUserNFT, Collection } from "@/types/user.types"
import { CORE_CONTRACT_ADDRESS } from "@/lib/constants"
import { useTx } from "@/app/context/TxContext"
import { UseBatchOperationsReturn } from "./useBatchOperations"

interface UseUserNftsParams {
  nfts: EnrichedUserNFT[]
  collections: Collection[]
  batchOps: UseBatchOperationsReturn
  userAddress: Address
}

export function useUserNfts({ nfts, collections, batchOps, userAddress }: UseUserNftsParams) {
  const publicClient = usePublicClient()

  const { writeContractAsync } = useWriteContract()
  const { address } = useAccount()
  const [approvalMap, setApprovalMap] = useState<Map<string, boolean>>(new Map())

  const { listTokensBatch, delistBatch, approveBatch, clearBatch } = batchOps
  const { addTx, removeTx, updateTx } = useTx()

  // Obtener direcciones de colecciones únicas
  const uniqueCollections = useMemo(() => {
    const addresses = new Set<string>()
    nfts.forEach((nft) => addresses.add(nft.collection_address.toLowerCase()))
    return Array.from(addresses)
  }, [nfts])

  // Verificar aprobaciones para cada colección
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

  // Actualizar mapa de aprobaciones
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

  // Verificar si todas las colecciones necesarias están aprobadas
  const allApproved = useMemo(() => {
    const collectionsToApprove = new Set(approveBatch.map((item: any) => item.toLowerCase()))
    for (const collection of collectionsToApprove) {
      if (!approvalMap.get(collection as string)) {
        return false
      }
    }
    return true
  }, [approveBatch, approvalMap])

  // Handler para delist
  const handleDelist = async () => {
    // Implementar lógica de delist
  }

  // Handler para approve collection
  const approveCollection = async (collectionAddress: Address) => {
    // Implementar lógica de approve
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
