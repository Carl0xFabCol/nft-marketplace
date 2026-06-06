// hooks/useBatchOperations.ts
import { useState, useCallback } from "react"
import { Address } from "viem"
import { UserNFT } from "@/types/user.types"

export type BatchType = "list" | "delist" | "approve" | "cancelTokenBid" | "buy" | "bid" | "cancelCollectionBid"

export interface UseBatchOperationsReturn {
  // Estados
  listTokensBatch: UserNFT[]
  delistBatch: UserNFT[]
  approveBatch: Address[]
  cancelTokenBidBatch: UserNFT[]
  cancelCollectionBidBatch: UserNFT[]
  buyBatch: UserNFT[]
  bidBatch: UserNFT[]

  // Acciones
  addToBatch: (item: UserNFT, type: BatchType) => void
  removeFromBatch: (item: UserNFT, type: BatchType) => void
  isInBatch: (item: UserNFT, type: BatchType) => boolean
  clearBatch: (type?: BatchType) => void
  clearAllBatches: () => void
}

export function useBatchOperations(): UseBatchOperationsReturn {
  const [listTokensBatch, setListBatch] = useState<UserNFT[]>([])
  const [delistBatch, setDelistBatch] = useState<UserNFT[]>([])
  const [approveBatch, setApproveBatch] = useState<Address[]>([])
  const [cancelTokenBidBatch, setCancelTokenBidBatch] = useState<UserNFT[]>([])
  const [cancelCollectionBidBatch, setCancelCollectionBidBatch] = useState<UserNFT[]>([])
  const [buyBatch, setBuyBatch] = useState<UserNFT[]>([])
  const [bidBatch, setBidBatch] = useState<UserNFT[]>([])

  const addToBatch = useCallback((item: UserNFT, type: BatchType) => {
    switch (type) {
      case "list":
        setListBatch((prev) => [...prev, item])
        break
      case "delist":
        setDelistBatch((prev) => [...prev, item])
        break
      case "approve":
        setApproveBatch((prev) => (prev.includes(item.collection_address) ? prev : [...prev, item.collection_address]))
        break
      case "cancelTokenBid":
        setCancelTokenBidBatch((prev) => [...prev, item])
        break
      case "cancelCollectionBid":
        setCancelCollectionBidBatch((prev) => [...prev, item])
        break
      case "buy":
        setBuyBatch((prev) => [...prev, item])
        break
      case "bid":
        setBidBatch((prev) => [...prev, item])
        break
    }
  }, [])

  const removeFromBatch = useCallback((item: UserNFT, type: BatchType) => {
    const matchesItem = (i: UserNFT) => i.token_id == item.token_id && i.collection_address.toLowerCase() == item.collection_address.toLowerCase()
    switch (type) {
      case "list":
        setListBatch((prev) => prev.filter((i) => !matchesItem(i)))
        break
      case "delist":
        setDelistBatch((prev) => prev.filter((i) => !matchesItem(i)))
        break
      case "approve":
        setApproveBatch((prev) => prev.filter((addr) => addr.toLowerCase() !== item.collection_address.toLowerCase()))
        break
      case "cancelTokenBid":
        setCancelTokenBidBatch((prev) => prev.filter((i) => !matchesItem(i)))
        break
      case "cancelCollectionBid":
        setCancelCollectionBidBatch((prev) => prev.filter((i) => !matchesItem(i)))
        break
      case "buy":
        setBuyBatch((prev) => prev.filter((i) => !matchesItem(i)))
        break
      case "bid":
        setBidBatch((prev) => prev.filter((i) => !matchesItem(i)))
        break
    }
  }, [])

  const isInBatch = useCallback(
    (item: UserNFT, type: BatchType): boolean => {
      const matchesItem = (i: UserNFT) => i.token_id == item.token_id && i.collection_address.toLowerCase() == item.collection_address.toLowerCase()

      switch (type) {
        case "list":
          return listTokensBatch.some(matchesItem)
        case "delist":
          return delistBatch.some(matchesItem)
        case "approve":
          return approveBatch.some((addr) => addr.toLowerCase() === item.collection_address.toLowerCase())
        case "cancelTokenBid":
          return cancelTokenBidBatch.some(matchesItem)
        case "cancelCollectionBid":
          return cancelCollectionBidBatch.some(matchesItem)
        case "buy":
          return buyBatch.some(matchesItem)
        case "bid":
          return bidBatch.some(matchesItem)
        default:
          return false
      }
    },
    [listTokensBatch, delistBatch, approveBatch, cancelTokenBidBatch, buyBatch, bidBatch],
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
