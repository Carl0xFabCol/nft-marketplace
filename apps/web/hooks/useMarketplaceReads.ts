"use client"

import { useReadContract } from "wagmi"
import { nftAbi, MarketplaceABI } from "@/lib/abi"
import { useContractAddresses } from "@/hooks/useContractAddresses"

export function useNftStats(NFT_CONTRACT_ADDRESS: `0x${string}`) {
  const { data: totalSupply } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: nftAbi,
    functionName: "totalSupply",
    query: {
      refetchInterval: false,
    },
  })

  const { data: maxSupply } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: nftAbi,
    functionName: "maxSupply",
  })

  const { data: mintPrice } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: nftAbi,
    functionName: "mintPrice",
  })

  return {
    totalSupply,
    maxSupply,
    mintPrice,
  }
}

export function useMarketplaceInfo() {
  const { MARKETPLACE_CONTRACT_ADDRESS } = useContractAddresses()

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

  return { marketplaceFee, feeReceiver, totalListings, totalSales, totalVolume, refetchTotalSales, refetchTotalVolume, refetchTotalListings }
}
