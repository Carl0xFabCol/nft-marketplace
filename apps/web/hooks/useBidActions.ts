"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import { MarketplaceABI } from "@/lib/abi"
import { useContractAddresses } from "@/hooks/useContractAddresses"
import type { Address, PublicClient } from "viem"

export function useBidToken(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses(chainId)

  const bidToken = async (collection: Address, tokenId: bigint, price: bigint, expiresAt: number) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "placeTokenBid",
      args: [collection, tokenId, price, BigInt(expiresAt)],
      value: price,
      chainId,
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

export function useBidTokenBatch(chainId: number): UseBidTokenBatchResult {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId })
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses(chainId)
  const bidTokenBatch = async (collection: `0x${string}`, tokenIds: bigint[], prices: bigint[], totalValue: bigint, expiresAts: number[]) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "placeTokenBidBatch",
      args: [collection, tokenIds, prices, expiresAts.map(BigInt)],
      value: totalValue,
      chainId,
    })
    return txHash
  }

  return { bidTokenBatch, publicClient }
}

export function useCancelTokenBid(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses(chainId)

  const cancelTokenBid = async (collection: `0x${string}`, tokenId: number) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "cancelTokenBid",
      args: [collection, BigInt(tokenId)],
      chainId,
    })
    return txHash
  }

  return { cancelTokenBid }
}

export function useCancelTokenBidBatch(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses(chainId)

  const cancelTokenBids = async (collections: `0x${string}`[], tokenIds: bigint[]) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "cancelTokenBidBatch",
      args: [collections, tokenIds],
      chainId,
    })
    return txHash
  }

  return { cancelTokenBids }
}

export function useAcceptTokenBid(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses(chainId)

  const acceptTokenBid = async (collection: `0x${string}`, tokenId: number, bidder: `0x${string}`) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "acceptTokenBid",
      args: [collection, BigInt(tokenId), bidder],
      chainId,
    })
    return txHash
  }

  return { acceptTokenBid }
}

export function useAcceptCollectionBid(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses(chainId)

  const acceptCollectionBid = async (collection: `0x${string}`, bidder: `0x${string}`, tokenIds: bigint[]) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "acceptCollectionBid",
      args: [collection, bidder, tokenIds],
      chainId,
    })
    return txHash
  }

  return { acceptCollectionBid }
}

export function useBidCollection(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses(chainId)

  const bidCollection = async (collection: Address, price: bigint, quantity: number, expiresAt: number) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "placeCollectionBid",
      args: [collection, price, quantity, BigInt(expiresAt)],
      value: price * BigInt(quantity),
      chainId,
    })
    return txHash
  }

  return { bidCollection }
}

export function useCancelCollectionBid(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses(chainId)

  const cancelCollectionBid = async (collection: `0x${string}`) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "cancelCollectionBid",
      args: [collection],
      chainId,
    })
    return txHash
  }

  return { cancelCollectionBid }
}
