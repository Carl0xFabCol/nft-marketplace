// types/user.types.ts
import { Address } from "viem";

export interface Collection {
  id: string;
  contract_address: Address;
  chain_id: number;
  name: string | null;
  symbol: string | null;
  description: string | null;
  image_url: string | null;
  creator_wallet: string | null;
  created_at: string | null;
  deployed_at: number | null;
  indexer_block: number | null;
  total_volume: number | null;
  total_sales: number | null;
  floor_price: string | null;
  updated_at: string | null;
  is_verified: boolean | null;
  nft_count: number;
  royalty_fee: number | null;
  owner_count?: number;
  top_bid?: any;
}

export interface Collection24h {
  id: string;
  contract_address: string;
  chain_id: number;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  total_volume: number | null;
  total_sales: number | null;
  floor_price: string | null;
  nft_count: number;
  is_verified: boolean;
}

export interface UserNFT {
  id: string;
  token_id: string;
  collection_address: Address;
  owner_wallet: Address;
  chain_id: number;
  name: string | null;
  description: string | null;
  image: string | null;
  metadata: any;
  attributes: any;
  created_at: string | null;
  updated_at: string | null;
  is_burned: boolean | null;
}

export interface UserListing {
  buyer_wallet: string | null;
  chain_id: number | null;
  collection_address: string;
  created_at: string;
  expires_at: string | null;
  id: string;
  is_active: boolean;
  listed_at: string | null;
  listing_id: string | null;
  price: number;
  seller_wallet: string | null;
  token_id: string;
  tx_hash: string;
  updated_at: string | null;
  /** "pending" (optimistic insert) → "confirmed" (indexer). */
  status?: string | null;
  /** "optimistic" | "indexer". */
  source?: string | null;
}

export interface UserCollectionBid {
  bidder_wallet: string;
  collection_address: string | null;
  created_at: string;
  expires_at: string | null;
  id: string;
  is_active: boolean | null;
  price: number | null;
  quantity: number | null;
  seller_wallet: string | null;
  updated_at: string | null;
}

export interface UserTokenBid {
  bidder_wallet: string | null;
  collection_address: string | null;
  created_at: string;
  expires_at: string | null;
  id: string;
  is_active: boolean | null;
  price: number | null;
  seller_wallet: string | null;
  token_id: string | null;
  updated_at: string | null;
}

export interface Activity {
  id: string;
  collection_address: Address;
  token_id: string;
  type: "sale" | "transfer" | "listing" | "bid" | "mint";
  from: Address;
  to: Address;
  price: string | null;
  tx_hash: string;
  created_at: string;
}

export interface EnrichedUserNFT extends UserNFT {
  active_listing?: UserListing | null;
  topBid?: {
    token_id: string;
    price: string;
    bidder_wallet: Address;
  } | null;
  collection?: Collection | null;
}

export interface UserData {
  listings: UserListing[];
  collectionBids: UserCollectionBid[];
  tokenBids: UserTokenBid[];
  collections: Collection[];
  nfts: EnrichedUserNFT[];
  activity: Activity[];
  hasMore: boolean;
}
