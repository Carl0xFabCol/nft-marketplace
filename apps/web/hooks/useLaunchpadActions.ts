"use client"

import { useReadContract, useWriteContract, usePublicClient } from "wagmi"
import type { PublicClient } from "viem"
import { LaunchPadABI } from "@/lib/abi"
import { useContractAddresses } from "@/hooks/useContractAddresses"

/**
 * Reads LaunchPad factory configuration for the connected chain.
 * The factory is only deployed on some chains (Elysium), so all reads are
 * disabled when no address is configured for the active chain.
 */
export function useLaunchpadInfo() {
  const { LAUNCHPAD_CONTRACT_ADDRESS } = useContractAddresses()
  const enabled = !!LAUNCHPAD_CONTRACT_ADDRESS

  const { data: launchFee } = useReadContract({
    address: LAUNCHPAD_CONTRACT_ADDRESS,
    abi: LaunchPadABI,
    functionName: "launchFee",
    query: { enabled },
  })

  const { data: maxRoyaltyFee } = useReadContract({
    address: LAUNCHPAD_CONTRACT_ADDRESS,
    abi: LaunchPadABI,
    functionName: "MAX_ROYALTY_FEE",
    query: { enabled },
  })

  const { data: paused } = useReadContract({
    address: LAUNCHPAD_CONTRACT_ADDRESS,
    abi: LaunchPadABI,
    functionName: "paused",
    query: { enabled },
  })

  return { launchFee, maxRoyaltyFee, paused }
}

export interface CreateCollectionParams {
  name: string
  symbol: string
  /** Royalty in basis points (e.g. 500 = 5%). */
  royaltyFee: number
  royaltyReceiver: `0x${string}`
  /** 0 means unlimited. */
  maxSupply: bigint
  baseURI: string
  /** Price per token in wei. 0 means free. */
  mintPrice: bigint
  /** Minting window in seconds from launch. 0 means forever. */
  mintDuration: bigint
}

export interface UseCreateCollectionResult {
  createCollection: (params: CreateCollectionParams, value: bigint) => Promise<`0x${string}`>
  publicClient: PublicClient | undefined
}

/**
 * Deploys a new MiColeccion through the LaunchPad factory. The factory
 * auto-registers the collection in MarketplaceCore, so it becomes tradeable
 * without any admin action.
 */
export function useCreateCollection(): UseCreateCollectionResult {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const { LAUNCHPAD_CONTRACT_ADDRESS } = useContractAddresses()

  const createCollection = async (params: CreateCollectionParams, value: bigint) => {
    if (!LAUNCHPAD_CONTRACT_ADDRESS) throw new Error("Launchpad is not available on this network")

    const hash = await writeContractAsync({
      address: LAUNCHPAD_CONTRACT_ADDRESS,
      abi: LaunchPadABI,
      functionName: "createCollection",
      args: [
        params.name,
        params.symbol,
        params.royaltyFee,
        params.royaltyReceiver,
        params.maxSupply,
        params.baseURI,
        params.mintPrice,
        params.mintDuration,
      ],
      value,
    })

    return hash
  }

  return { createCollection, publicClient }
}
