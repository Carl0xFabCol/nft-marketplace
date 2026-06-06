// NFT domain types

export interface NFT {
  id: string;
  token_id: string;
  collection_address: string;
  owner_wallet: string;
  chain_id: number;
  name: string | null;
  symbol: string | null;
  description: string | null;
  image_url: string | null;
  token_uri: string | null;
  metadata: Record<string, unknown> | null;
  attributes: unknown[] | null;
  last_synced: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_burned: boolean | null;
}

/** NFT enriched with marketplace data */
export interface EnrichedNFT extends NFT {
  active_listing?: ActiveListing | null;
  topBid?: TopBid | null;
  collection?: import("./collection").Collection | null;
}

/** Minimal listing data attached to an NFT */
export interface ActiveListing {
  id: string;
  price: number;
  seller_wallet: string | null;
  token_id: string;
  expires_at: string | null;
  is_active: boolean;
  collection_address: string;
}

/** Minimal bid data attached to an NFT */
export interface TopBid {
  token_id: string;
  price: number;
  bidder_wallet: string;
  collection_address: string;
}
