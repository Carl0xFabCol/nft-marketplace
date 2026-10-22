"use client"

import { useReadContract, useAccount } from "wagmi"
import { MiColeccionABI, MarketplaceABI } from "@/lib/abi"
import { useContractAddresses } from "@/hooks/useContractAddresses"

export function useNftStats(NFT_CONTRACT_ADDRESS: `0x${string}`) {
  const { data: totalSupply, refetch: refetchTotalSupply } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: MiColeccionABI,
    functionName: "totalSupply",
    query: {
      refetchInterval: false,
    },
  })

  const { data: maxSupply } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: MiColeccionABI,
    functionName: "maxSupply",
  })

  const { data: mintPrice } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: MiColeccionABI,
    functionName: "mintPrice",
  })

  const { data: mintEndsAt } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: MiColeccionABI,
    functionName: "mintEndsAt",
  })

  const { data: isMintActive } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: MiColeccionABI,
    functionName: "isMintActive",
  })

  return {
    totalSupply,
    refetchTotalSupply,
    maxSupply,
    mintPrice,
    mintEndsAt,
    isMintActive,
  }
}

export function useMarketplaceInfo() {
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

  const { data: owner }: any = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "owner",
  })

  const { data: marketplaceFee }: any = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "marketplaceFee",
  })

  const { data: feeReceiver }: any = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "feeReceiver",
  })

  const { data: totalListings, refetch: refetchTotalListings }: any = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "totalListings",
  })

  const { data: totalSales, refetch: refetchTotalSales }: any = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "totalSales",
  })

  const { data: totalVolume, refetch: refetchTotalVolume }: any = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "totalVolume",
  })

  return { owner, marketplaceFee, feeReceiver, totalListings, totalSales, totalVolume, refetchTotalSales, refetchTotalVolume, refetchTotalListings }
}

/**
 * External collection registration is restricted to the marketplace owner/admin.
 * Launchpad-created collections are registered automatically by the factory.
 */
export function useIsMarketplaceAdmin() {
  const { address } = useAccount()
  const { owner } = useMarketplaceInfo()

  return {
    owner: owner as `0x${string}` | undefined,
    isAdmin: !!address && !!owner && address.toLowerCase() === (owner as string).toLowerCase(),
  }
}
