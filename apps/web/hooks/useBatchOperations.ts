// hooks/useBatchOperations.ts
import { useState, useCallback } from "react"
import { Address } from "viem"
import { BatchNFT, UserCollectionBid, UserTokenBid } from "@/types/user.types"

export type BatchType = "list" | "delist" | "approve" | "cancelTokenBid" | "buy" | "bid" | "cancelCollectionBid"

export type BatchItem = BatchNFT | UserTokenBid | UserCollectionBid

export interface UseBatchOperationsReturn {
  // State
  listTokensBatch: BatchNFT[]
  delistBatch: BatchNFT[]
  approveBatch: Address[]
  cancelTokenBidBatch: UserTokenBid[]
  cancelCollectionBidBatch: UserCollectionBid[]
  buyBatch: BatchNFT[]
  bidBatch: BatchNFT[]

  // Actions
  addToBatch: (item: BatchItem, type: BatchType) => void
  removeFromBatch: (item: BatchItem, type: BatchType) => void
  isInBatch: (item: BatchItem, type: BatchType) => boolean
  clearBatch: (type?: BatchType) => void
  clearAllBatches: () => void
}

export function useBatchOperations(): UseBatchOperationsReturn {
  const [listTokensBatch, setListBatch] = useState<BatchNFT[]>([])
  const [delistBatch, setDelistBatch] = useState<BatchNFT[]>([])
  const [approveBatch, setApproveBatch] = useState<Address[]>([])
  const [cancelTokenBidBatch, setCancelTokenBidBatch] = useState<UserTokenBid[]>([])
  const [cancelCollectionBidBatch, setCancelCollectionBidBatch] = useState<UserCollectionBid[]>([])
  const [buyBatch, setBuyBatch] = useState<BatchNFT[]>([])
  const [bidBatch, setBidBatch] = useState<BatchNFT[]>([])

  const addToBatch = useCallback((item: BatchItem, type: BatchType) => {
    switch (type) {
      case "list":
        setListBatch((prev) => [...prev, item as BatchNFT])
        break
      case "delist":
        setDelistBatch((prev) => [...prev, item as BatchNFT])
        break
      case "approve":
        setApproveBatch((prev) => (prev.includes(item.collection_address as Address) ? prev : [...prev, item.collection_address as Address]))
        break
      case "cancelTokenBid":
        setCancelTokenBidBatch((prev) => [...prev, item as UserTokenBid])
        break
      case "cancelCollectionBid":
        setCancelCollectionBidBatch((prev) => [...prev, item as UserCollectionBid])
        break
      case "buy":
        setBuyBatch((prev) => [...prev, item as BatchNFT])
        break
      case "bid":
        setBidBatch((prev) => [...prev, item as BatchNFT])
        break
    }
  }, [])

  const removeFromBatch = useCallback((item: BatchItem, type: BatchType) => {
    const itemTokenId = "token_id" in item ? item.token_id : undefined
    const matchesNft = (i: BatchNFT) => i.token_id == itemTokenId && i.collection_address.toLowerCase() == item.collection_address?.toLowerCase()
    const matchesTokenBid = (i: UserTokenBid) => i.token_id == itemTokenId && String(i.collection_address).toLowerCase() == String(item.collection_address).toLowerCase()
    const matchesCollectionBid = (i: UserCollectionBid) => String(i.collection_address).toLowerCase() == String(item.collection_address).toLowerCase()

    switch (type) {
      case "list":
        setListBatch((prev) => prev.filter((i) => !matchesNft(i)))
        break
      case "delist":
        setDelistBatch((prev) => prev.filter((i) => !matchesNft(i)))
        break
      case "approve":
        setApproveBatch((prev) => prev.filter((addr) => addr.toLowerCase() !== item.collection_address?.toLowerCase()))
        break
      case "cancelTokenBid":
        setCancelTokenBidBatch((prev) => prev.filter((i) => !matchesTokenBid(i)))
        break
      case "cancelCollectionBid":
        setCancelCollectionBidBatch((prev) => prev.filter((i) => !matchesCollectionBid(i)))
        break
      case "buy":
        setBuyBatch((prev) => prev.filter((i) => !matchesNft(i)))
        break
      case "bid":
        setBidBatch((prev) => prev.filter((i) => !matchesNft(i)))
        break
    }
  }, [])

  const isInBatch = useCallback(
    (item: BatchItem, type: BatchType): boolean => {
      const itemTokenId = "token_id" in item ? item.token_id : undefined
      const matchesNft = (i: BatchNFT) => i.token_id == itemTokenId && i.collection_address.toLowerCase() == item.collection_address?.toLowerCase()
      const matchesTokenBid = (i: UserTokenBid) => i.token_id == itemTokenId && String(i.collection_address).toLowerCase() == String(item.collection_address).toLowerCase()
      const matchesCollectionBid = (i: UserCollectionBid) => String(i.collection_address).toLowerCase() == String(item.collection_address).toLowerCase()

      switch (type) {
        case "list":
          return listTokensBatch.some(matchesNft)
        case "delist":
          return delistBatch.some(matchesNft)
        case "approve":
          return approveBatch.some((addr) => addr.toLowerCase() === item.collection_address?.toLowerCase())
        case "cancelTokenBid":
          return cancelTokenBidBatch.some(matchesTokenBid)
        case "cancelCollectionBid":
          return cancelCollectionBidBatch.some(matchesCollectionBid)
        case "buy":
          return buyBatch.some(matchesNft)
        case "bid":
          return bidBatch.some(matchesNft)
        default:
          return false
      }
    },
    [listTokensBatch, delistBatch, approveBatch, cancelTokenBidBatch, cancelCollectionBidBatch, buyBatch, bidBatch],
  )

  const clearBatch = useCallback((type?: BatchType) => {
    if (!type) return

    switch (type) {
      case "list":
        setListBatch([])
        break
      case "delist":
        setDelistBatch([])
        break
      case "approve":
        setApproveBatch([])
        break
      case "cancelTokenBid":
        setCancelTokenBidBatch([])
        break
      case "cancelCollectionBid":
        setCancelCollectionBidBatch([])
        break
      case "buy":
        setBuyBatch([])
        break
      case "bid":
        setBidBatch([])
        break
    }
  }, [])

  const clearAllBatches = useCallback(() => {
    setListBatch([])
    setDelistBatch([])
    setApproveBatch([])
    setCancelTokenBidBatch([])
    setCancelCollectionBidBatch([])
    setBuyBatch([])
    setBidBatch([])
  }, [])

  return {
    cancelCollectionBidBatch,
    listTokensBatch,
    delistBatch,
    approveBatch,
    cancelTokenBidBatch,
    buyBatch,
    bidBatch,
    addToBatch,
    removeFromBatch,
    isInBatch,
    clearBatch,
    clearAllBatches,
  }
}
