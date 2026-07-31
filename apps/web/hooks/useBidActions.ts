"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import { MarketplaceABI } from "@/lib/abi"
import { MARKETPLACE_CONTRACT_ADDRESS } from "@/lib/constants"
import { Address } from "viem"

export function useBidToken() {
  const { writeContractAsync } = useWriteContract()

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

export function useBidTokenBatch() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
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

export function useBidCollection() {
  const { writeContractAsync } = useWriteContract()

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
