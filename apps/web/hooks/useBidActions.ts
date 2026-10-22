"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import { MarketplaceABI } from "@/lib/abi"
import { useContractAddresses } from "@/hooks/useContractAddresses"
import type { Address, PublicClient } from "viem"

export function useBidToken() {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const bidToken = async (collection: Address, tokenId: bigint, price: bigint, expiresAt: number) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "placeTokenBid",
      args: [collection, tokenId, price, BigInt(expiresAt)],
      value: price,
    })
    return txHash
  }

  return { bidToken }
}

export interface UseBidTokenBatchResult {
  bidTokenBatch: (
    collection: `0x${string}`,
    tokenIds: bigint[],
    prices: bigint[],
    totalValue: bigint,
    expiresAts: number[],
  ) => Promise<`0x${string}`>
  publicClient: PublicClient | undefined
}

export function useBidTokenBatch(): UseBidTokenBatchResult {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()
  const bidTokenBatch = async (collection: `0x${string}`, tokenIds: bigint[], prices: bigint[], totalValue: bigint, expiresAts: number[]) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "placeTokenBidBatch",
      args: [collection, tokenIds, prices, expiresAts.map(BigInt)],
      value: totalValue,
    })
    return txHash
  }

  return { bidTokenBatch, publicClient }
}

export function useCancelTokenBid() {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const cancelTokenBid = async (collection: `0x${string}`, tokenId: number) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "cancelTokenBid",
      args: [collection, BigInt(tokenId)],
    })
    return txHash
  }

  return { cancelTokenBid }
}

export function useCancelTokenBidBatch() {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const cancelTokenBids = async (collections: `0x${string}`[], tokenIds: bigint[]) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "cancelTokenBidBatch",
      args: [collections, tokenIds],
    })
    return txHash
  }

  return { cancelTokenBids }
}

export function useAcceptTokenBid() {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const acceptTokenBid = async (collection: `0x${string}`, tokenId: number, bidder: `0x${string}`) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "acceptTokenBid",
      args: [collection, BigInt(tokenId), bidder],
    })
    return txHash
  }

  return { acceptTokenBid }
}

export function useAcceptCollectionBid() {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const acceptCollectionBid = async (collection: `0x${string}`, bidder: `0x${string}`, tokenIds: bigint[]) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "acceptCollectionBid",
      args: [collection, bidder, tokenIds],
    })
    return txHash
  }

  return { acceptCollectionBid }
}

export function useBidCollection() {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const bidCollection = async (collection: Address, price: bigint, quantity: number, expiresAt: number) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "placeCollectionBid",
      args: [collection, price, quantity, BigInt(expiresAt)],
      value: price * BigInt(quantity),
    })
    return txHash
  }

  return { bidCollection }
}

export function useCancelCollectionBid() {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const cancelCollectionBid = async (collection: `0x${string}`) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "cancelCollectionBid",
      args: [collection],
    })
    return txHash
  }

  return { cancelCollectionBid }
}
