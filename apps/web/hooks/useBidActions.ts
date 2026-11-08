"use client"

import { useWriteContract, usePublicClient } from "wagmi"
import { MarketplaceABI } from "@/lib/abi"
import { useWriteGuard } from "@/hooks/useWriteGuard"
import { requireChainContracts } from "@/lib/chainGuard"
import { useSlippageBps } from "@/hooks/useSlippageBps"
import {
  acceptBounds,
  quoteCollectionBid as quoteCollectionBidOnChain,
  quoteTokenBid as quoteTokenBidOnChain,
  type AcceptQuote,
} from "@/lib/bidAcceptance"
import type { Address, PublicClient } from "viem"

export function useBidToken(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const guardWrite = useWriteGuard(chainId)

  const bidToken = async (collection: Address, tokenId: bigint, price: bigint, expiresAt: number) => {
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
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
  const guardWrite = useWriteGuard(chainId)
  const bidTokenBatch = async (collection: `0x${string}`, tokenIds: bigint[], prices: bigint[], totalValue: bigint, expiresAts: number[]) => {
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
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
  const guardWrite = useWriteGuard(chainId)

  const cancelTokenBid = async (collection: `0x${string}`, tokenId: number) => {
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
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
  const guardWrite = useWriteGuard(chainId)

  const cancelTokenBids = async (collections: `0x${string}`[], tokenIds: bigint[]) => {
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
      abi: MarketplaceABI,
      functionName: "cancelTokenBidBatch",
      args: [collections, tokenIds],
      chainId,
    })
    return txHash
  }

  return { cancelTokenBids }
}

/**
 * Token-bid acceptance (ABI-1). Two steps so the seller sees exactly what is
 * signed: `quoteTokenBid` reads the on-chain bid, fee and royalty; the UI shows
 * that quote; `acceptTokenBid(quote)` passes minPrice / minSellerProceeds
 * derived from it with the single slippage setting (useSlippageBps, 0 today).
 */
export function useAcceptTokenBid(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId })
  const guardWrite = useWriteGuard(chainId)
  const slippageBps = useSlippageBps()

  const quoteTokenBid = async (params: { collection: Address; tokenId: bigint; bidder: Address; shownPrice: bigint }): Promise<AcceptQuote> => {
    if (!publicClient) throw new Error("No RPC client for this network")
    return quoteTokenBidOnChain(publicClient, { router: requireChainContracts(chainId).MARKETPLACE, ...params })
  }

  const acceptTokenBid = async (quote: AcceptQuote) => {
    if (quote.kind !== "token" || quote.tokenIds.length !== 1) throw new Error("Not a token-bid quote")
    const { minPrice, minSellerProceeds } = acceptBounds(quote, slippageBps)
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
      abi: MarketplaceABI,
      functionName: "acceptTokenBid",
      args: [quote.collection, quote.tokenIds[0], quote.bidder, minPrice, minSellerProceeds],
      chainId,
    })
    return txHash
  }

  return { quoteTokenBid, acceptTokenBid }
}

/** Collection-bid acceptance; same two-step contract as useAcceptTokenBid. */
export function useAcceptCollectionBid(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId })
  const guardWrite = useWriteGuard(chainId)
  const slippageBps = useSlippageBps()

  const quoteCollectionBid = async (params: { collection: Address; bidder: Address; tokenIds: bigint[]; shownPricePerItem: bigint }): Promise<AcceptQuote> => {
    if (!publicClient) throw new Error("No RPC client for this network")
    return quoteCollectionBidOnChain(publicClient, { router: requireChainContracts(chainId).MARKETPLACE, ...params })
  }

  const acceptCollectionBid = async (quote: AcceptQuote) => {
    if (quote.kind !== "collection") throw new Error("Not a collection-bid quote")
    const { minPrice, minSellerProceeds } = acceptBounds(quote, slippageBps)
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
      abi: MarketplaceABI,
      functionName: "acceptCollectionBid",
      args: [quote.collection, quote.bidder, quote.tokenIds, minPrice, minSellerProceeds],
      chainId,
    })
    return txHash
  }

  return { quoteCollectionBid, acceptCollectionBid }
}

export function useBidCollection(chainId: number) {
  const { writeContractAsync } = useWriteContract()
  const guardWrite = useWriteGuard(chainId)

  const bidCollection = async (collection: Address, price: bigint, quantity: number, expiresAt: number) => {
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
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
  const guardWrite = useWriteGuard(chainId)

  const cancelCollectionBid = async (collection: `0x${string}`) => {
    const txHash = await writeContractAsync({
      address: guardWrite().MARKETPLACE,
      abi: MarketplaceABI,
      functionName: "cancelCollectionBid",
      args: [collection],
      chainId,
    })
    return txHash
  }

  return { cancelCollectionBid }
}
