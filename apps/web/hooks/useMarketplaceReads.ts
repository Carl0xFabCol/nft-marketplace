"use client"

import { useReadContract, useAccount } from "wagmi"
import { MiColeccionABI, MarketplaceABI } from "@/lib/abi"
import { useContractAddresses } from "@/hooks/useContractAddresses"

export function useNftStats(NFT_CONTRACT_ADDRESS: `0x${string}`, chainId: number) {
  const { data: totalSupply, refetch: refetchTotalSupply } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: MiColeccionABI,
    functionName: "totalSupply",
    chainId,
    query: {
      refetchInterval: false,
    },
  })

  const { data: maxSupply } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: MiColeccionABI,
    functionName: "maxSupply",
    chainId,
  })

  const { data: mintPrice } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: MiColeccionABI,
    functionName: "mintPrice",
    chainId,
  })

  const { data: mintEndsAt } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: MiColeccionABI,
    functionName: "mintEndsAt",
    chainId,
  })

  const { data: isMintActive } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: MiColeccionABI,
    functionName: "isMintActive",
    chainId,
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

export function useMarketplaceInfo(chainId: number) {
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses(chainId)

  const { data: owner } = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "owner",
    chainId,
    query: { enabled: !!MARKETPLACE_CONTRACT_ADDRESS },
  })

  const { data: marketplaceFee } = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "marketplaceFee",
    chainId,
    query: { enabled: !!MARKETPLACE_CONTRACT_ADDRESS },
  })

  const { data: feeReceiver } = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "feeReceiver",
    chainId,
    query: { enabled: !!MARKETPLACE_CONTRACT_ADDRESS },
  })

  const { data: totalListings, refetch: refetchTotalListings } = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "totalListings",
    chainId,
    query: { enabled: !!MARKETPLACE_CONTRACT_ADDRESS },
  })

  const { data: totalSales, refetch: refetchTotalSales } = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "totalSales",
    chainId,
    query: { enabled: !!MARKETPLACE_CONTRACT_ADDRESS },
  })

  const { data: totalVolume, refetch: refetchTotalVolume } = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS,
    abi: MarketplaceABI,
    functionName: "totalVolume",
    chainId,
    query: { enabled: !!MARKETPLACE_CONTRACT_ADDRESS },
  })

  return { owner, marketplaceFee, feeReceiver, totalListings, totalSales, totalVolume, refetchTotalSales, refetchTotalVolume, refetchTotalListings }
}

/**
 * External collection registration is restricted to the marketplace owner/admin.
 * Launchpad-created collections are registered automatically by the factory.
 */
export function useIsMarketplaceAdmin(chainId: number) {
  const { address } = useAccount()
  const { owner } = useMarketplaceInfo(chainId)

  return {
    owner: owner as `0x${string}` | undefined,
    isAdmin: !!address && !!owner && address.toLowerCase() === (owner as string).toLowerCase(),
  }
}
