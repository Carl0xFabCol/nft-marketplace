// types/user.types.ts
import { Address } from "viem"
import { Tables } from "@/lib/supabase/types"

export interface UserProfile {
  id: string
  wallet: Address
  username: string | null
  bio: string | null
  avatar_url: string | null
  created_at: string | null
}

/** An owned NFT that can be selected as the profile picture. */
export interface ProfileNftOption {
  id: string
  collection_address: Address
  token_id: string
  name: string | null
  image_url: string
}

export interface Collection {
  id: string
  contract_address: Address
  chain_id: number
  name: string | null
  symbol: string | null
  description: string | null
  image_url: string | null
  banner_url?: string | null
  creator_wallet: string | null
  created_at: string | null
  deployed_at: number | null
  indexer_block: number | null
  total_volume: number | null
  total_sales: number | null
  floor_price: number | string | null
  updated_at: string | null
  is_verified: boolean | null
  nft_count: number
  royalty_fee: number | null
  owner_count?: number
  top_bid?: Tables<"collection_bids"> | null
}

/** A collection plus the viewer-specific flags used on the user page. */
export interface UserCollectionSummary extends Collection {
  user_nft_count: number
  has_nfts: boolean
  has_collection_bid: boolean
  has_token_bid: boolean
}

export interface Collection24h {
  id: string
  contract_address: string
  chain_id: number
  name: string | null
  symbol: string | null
  image_url: string | null
  total_volume: number | null
  total_sales: number | null
  floor_price: number | string | null
  nft_count: number
  is_verified: boolean
}

export interface UserNFT {
  id: string
  token_id: string
  collection_address: Address
  owner_wallet: Address
  chain_id: number
  name: string | null
  description: string | null
  image_url: string | null
  metadata: NFTMetadata | null
  attributes: NFTMetadata["attributes"] | null
  created_at: string | null
  updated_at: string | null
  is_burned: boolean | null
}

export interface UserListing {
  buyer_wallet: string | null
  chain_id: number | null
  collection_address: string
  created_at: string
  expires_at: string | null
  id: string
  is_active: boolean
  listed_at: string | null
  listing_id: string | null
  price: number
  seller_wallet: string | null
  token_id: string
  tx_hash: string
  updated_at: string | null
  /** "pending" (optimistic insert) → "confirmed" (indexer). */
  status?: string | null
  /** "optimistic" | "indexer". */
  source?: string | null
}

export interface UserCollectionBid {
  bidder_wallet: string
  collection_address: string | null
  created_at: string
  expires_at: string | null
  id: string
  is_active: boolean | null
  price: number | null
  quantity: number | null
  seller_wallet: string | null
  updated_at: string | null
}

export interface UserTokenBid {
  bidder_wallet: string | null
  collection_address: string | null
  created_at: string
  expires_at: string | null
  id: string
  is_active: boolean | null
  price: number | null
  seller_wallet: string | null
  token_id: string | null
  updated_at: string | null
}

export interface Activity {
  id: string
  event: string
  collection_address: Address
  token_id: string
  type?: "sale" | "transfer" | "listing" | "bid" | "mint"
  from: Address | null
  to: Address | null
  price: string | null
  tx_hash: string
  created_at: string
}

export interface EnrichedUserNFT extends UserNFT {
  active_listing?: UserListing | null
  topBid?: {
    kind: "token" | "collection"
    collection_address: Address
    price: string
    bidder_wallet: Address
    quantity?: number
    token_id?: string
  } | null
  collection?: Collection | null
}

/** NFT shape used by the batch (buy/bid/list) flows. */
export type BatchNFT = EnrichedUserNFT & {
  price?: number | string | null
  seller_wallet?: string | null
}

export interface UserData {
  listings: UserListing[]
  collectionBids: UserCollectionBid[]
  tokenBids: UserTokenBid[]
  collections: UserCollectionSummary[]
  nfts: EnrichedUserNFT[]
  activity: Activity[]
  hasMore: boolean
}

export interface UserPageData extends UserData {
  activityTotalPages: number
}

/** Token metadata as hydrated from the `nfts.metadata` JSONB column. */
export interface NFTMetadata {
  name?: string
  image?: string
  description?: string
  attributes?: Array<{ trait_type: string; value: string | number }>
}

/**
 * Shape returned by `NFTService.getNFTDetail`: the `nfts` row plus its
 * active listing, token bids, parent collection and activity history.
 */
export type NFTDetail = Omit<Tables<"nfts">, "metadata" | "collection_address"> & {
  collection_address: Address
  metadata?: NFTMetadata | null
  /** Optional display name for the owner (not part of the DB row). */
  ownerName?: string
  /** Active listing for this token (if any). */
  listing?: UserListing | null
  /** Active token bids, highest first. */
  bids?: UserTokenBid[]
  /** Parent collection row. */
  collection?: Tables<"collections"> | null
  /** Activity rows for this token, newest first. */
  history?: Tables<"activity">[]
}
