// ─────────────────────────────────────────────────────────────────────────────
// Collection domain types — canonical definition.
// Previously duplicated in apps/web/types/user.types.ts and
// apps/web/services/collections.service.ts. This is the single source.
// ─────────────────────────────────────────────────────────────────────────────

/** Full collection record as stored in the database */
export interface Collection {
  id: string;
  contract_address: string;
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
  /** Floor price in wei, stored as string to avoid precision loss */
  floor_price: string | null;
  updated_at: string | null;
  is_verified: boolean | null;
  royalty_fee: number | null;
  /** Derived: number of NFTs in the collection (not null-owner) */
  nft_count?: number;
  /** Derived: top bid for this collection */
  top_bid?: CollectionTopBid | null;
}

/** Top bid for a collection */
export interface CollectionTopBid {
  price: string;
  bidder_wallet: string;
  collection_address: string;
  created_at: string;
}

/** Stats snapshot for 24h volume ranking */
export interface Collection24hStats {
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
  /** 24h volume in HYPE */
  volume_24h?: number;
  /** 24h sales count */
  sales_24h?: number;
  rank?: number;
}

/** Detailed stats for a single collection */
export interface CollectionStats {
  /** Floor price in wei as string */
  floor_price: string;
  total_volume: number;
  total_sales: number;
  nft_count: number;
  owner_count: number;
  avg_price: number;
  market_cap: number;
}
