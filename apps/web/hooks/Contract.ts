"use client"

import { useReadContract, useWriteContract, usePublicClient } from "wagmi"
import { nftAbi, MarketplaceABI, MockAbi } from "@/lib/abi"
import { MARKETPLACE_CONTRACT_ADDRESS } from "@/lib/constants"
import { useQuery } from "@tanstack/react-query"
import { Address } from "viem"

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

export function useUserTokens(address: `0x${string}`, collections: any[], enabled = false) {
  const publicClient = usePublicClient()
  return useQuery({
    queryKey: ["user-tokens", address],
    enabled: Boolean(address && collections?.length && enabled),
    queryFn: async () => {
      const tokens: { token_id: bigint; collection_address: Address }[] = []
      for (let i = 0; i < collections.length; i++) {
        try {
          const _tokens: any = await publicClient?.readContract({
            address: collections[i].contract_address,
            abi: nftAbi,
            functionName: "tokensOfOwner",
            args: [address],
          })
          for (let t of _tokens as bigint[]) {
            tokens.push({ token_id: t, collection_address: collections[i].contract_address })
          }
        } catch (e) {
          console.error("Error useUserTokens: ", e)
        }
      }
      return { tokens: tokens }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export function useMint() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const mint = async (amount: number, address: `0x${string}`, to: `0x${string}`) => {
    const hash = await writeContractAsync({
      address: address,
      abi: MockAbi,
      functionName: "batchMint",
      args: [to, BigInt(amount)],
    })

    return hash
  }

  return { mint, publicClient }
}

// export function useBurn() {
//   const { writeContractAsync } = useWriteContract()

//   const burn = async (tokenId: number) => {
//     const hash = await writeContractAsync({
//       address: NFT_CONTRACT_ADDRESS,
//       abi: nftAbi,
//       functionName: "burn",
//       args: [BigInt(tokenId)],
//     })
//     return hash
//   }

//   return { burn }
// }

///// MARKETPLACE //////

// ----------- READ HOOKS ------------

export function useMarketplaceInfo() {
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

// ----------- WRITE HOOKS ------------

export function useList() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const list = async (collection: Address, tokenId: bigint, price: bigint, expiresAt: bigint) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "createListing",
      args: [collection, tokenId, price, expiresAt],
    })
    return txHash
  }

  return { list, publicClient }
}

export function useListBatch() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const listBatch = async (_collections: `0x${string}`[], _tokenIds: bigint[], prices: bigint[], expiresAts: bigint[]) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "createListingBatch",
      args: [_collections, _tokenIds, prices, expiresAts],
    })
    return txHash
  }

  return { listBatch, publicClient }
}

export function useUpdateListing() {
  const { writeContractAsync } = useWriteContract()

  const updateListing = async (collection: Address, tokenId: bigint, price: bigint) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "updateListingPrice",
      args: [collection, tokenId, price],
    })
    return txHash
  }

  return { updateListing }
}

export function useCancelList() {
  const { writeContractAsync } = useWriteContract()

  const cancelList = async (collection: `0x${string}`, tokenId: number) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "cancelListing",
      args: [collection, BigInt(tokenId)],
    })
    return txHash
  }

  return { cancelList }
}

export function useCancelListBatch() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const cancelListBatch = async (_collections: `0x${string}`[], _tokenIds: bigint[]) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "cancelListingBatch",
      args: [_collections, _tokenIds],
    })
    return txHash
  }

  return { cancelListBatch, publicClient }
}

export function useBuy() {
  const { writeContractAsync } = useWriteContract()

  const buy = async (collection: `0x${string}`, tokenId: bigint, value: bigint) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "buy",
      args: [collection, tokenId],
      value,
    })
    return txHash
  }

  return { buy }
}

export function useBuyBatch() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const buyBatch = async (_collection: `0x${string}`, _tokenIds: bigint[], value: bigint) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "buyBatch",
      args: [_collection, _tokenIds],
      value,
    })
    return txHash
  }

  return { buyBatch, publicClient }
}

export function useBidToken() {
  const { writeContractAsync } = useWriteContract()

  const bidToken = async (collection: Address, tokenId: bigint, price: bigint, expiresAt: number) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "placeTokenBid",
      args: [collection, tokenId, price, expiresAt],
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
      args: [collection, tokenIds, prices, expiresAts],
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
      args: [collection, tokenId, bidder],
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
      args: [collection, price, BigInt(quantity), expiresAt],
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

export function useAcceptCollectionBid() {
  const { writeContractAsync } = useWriteContract()

  const acceptCollectionBid = async (collection: `0x${string}`, bidder: `0x${string}`, tokenIds: number[]) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "acceptCollectionBid",
      args: [collection, bidder, tokenIds.map((id) => BigInt(id))],
    })
    return txHash
  }

  return { acceptCollectionBid }
}

export function useRegisterCollection() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const registerCollection = async (collection: `0x${string}`, royaltyFee: bigint, receiver: `0x${string}`) => {
    const txHash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "registerCollection",
      args: [collection, royaltyFee, receiver],
    })
    return txHash
  }

  return { registerCollection, publicClient }
}
