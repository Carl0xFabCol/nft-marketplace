import type { Metadata } from "next"
import { Address } from "viem"

export const MARKETPLACE_CONTRACT_ADDRESS = "0x55495153De44570DFC37B2daC4Bc13241B3C2e87"
export const BIDS_CONTRACT_ADDRESS = "0x613CeD51Fd25F67FEcc0c5C22981d42397eddFb1"
export const CORE_CONTRACT_ADDRESS = "0x36052B33e4f10E3264B89961EC3873374Fedc793"

export const metadata: Metadata = {
  title: "SUP!",
  description: "Created by Fractalio",
}

export type IndexedListing = {
  id: bigint
  collection: "0x${string}"
  tokenId: bigint
  seller: "0x${string}"
  price: bigint
  status: "ACTIVE" | "SOLD" | "CANCELLED"
  createdAtBlock: bigint
  updatedAtBlock: bigint
}

export type ListingsState = {
  byKey: Map<string, IndexedListing>
  all: IndexedListing[]
}

export type ListedNft = {
  id: bigint
  seller_wallet: `0x${string}`
  collection_address: `0x${string}`
  token_id: string
  price: bigint
  createdAtBlock: bigint
  priceEth: string | number
}

export type UserNft = {
  token_id: string
  collection_address: Address
  price?: bigint
  listed: boolean
  priceEth?: string
  name: string
}

export type TxState = {
  txHash?: string
  txStatus: "idle" | "waiting" | "loading" | "success" | "error"
  action: "list" | "delist" | "buy" | "bidToken" | "cancelTokenBid" | "bidCollection" | "cancelCollectionBid" | "approve" | "none"
}

export type ListedNFTSProps = {
  listings: ListedNft[]
  userListings: ListedNft[]
  refetchTotalVolume: any
  refetchTotalSales: any
  collections: any[]
  collectionBids: any[]
  tokenBids: any[]
}

export type SortBy = "id" | "price"
export type SortDir = "asc" | "desc"

export const listingCreatedEventAbi = "event ListingCreated(uint indexed id, address indexed collection, uint indexed tokenId, address seller, uint price)"
export const listingCancelledEventAbi = "event ListingCancelled(uint indexed id, address indexed collection, uint indexed tokenId, address seller, uint price)"
export const listingSoldEventAbi =
  "event ListingSold(uint indexed id, address indexed collection, uint256 indexed tokenId, address seller, address buyer, uint256 price, uint256 marketplaceFee, uint256 royaltyFee)"
export const bidSoldEventAbi = "event BidSold(address indexed collection, uint256 indexed tokenId, address indexed seller, address buyer, uint256 price, uint256 marketplaceFee, uint256 royaltyFee)"
