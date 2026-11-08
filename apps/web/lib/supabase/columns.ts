// lib/supabase/columns.ts
//
// Explicit select lists for the tables that hold on-chain amounts. PostgREST
// returns `numeric` as a JSON number, which JSON.parse rounds above 2^53, so
// every wei column (numeric(78,0)) and collections.total_volume (numeric,
// ether) is cast to text in the query: `price::text` keeps the key `price`
// and arrives as an exact decimal string (see lib/wei.ts).
//
// Never `select("*")` on these tables in apps/web: services/weiText.test.ts
// fails if a query does.

import type { Tables } from "@/lib/supabase/types"

export const LISTING_COLUMNS =
  "id, listing_id, chain_id, collection_address, token_id, seller_wallet, buyer_wallet, price::text, is_active, status, source, listed_at, expires_at, tx_hash, created_at, updated_at" as const

export const TOKEN_BID_COLUMNS =
  "id, chain_id, collection_address, token_id, bidder_wallet, seller_wallet, price::text, is_active, expires_at, created_at, updated_at" as const

export const COLLECTION_BID_COLUMNS =
  "id, chain_id, collection_address, bidder_wallet, seller_wallet, price::text, quantity, is_active, expires_at, created_at, updated_at" as const

export const COLLECTION_COLUMNS =
  "id, chain_id, contract_address, name, symbol, description, image_url, banner_url, creator_wallet, created_at, updated_at, deployed_at, indexer_block, is_verified, royalty_fee, total_sales, total_volume::text, floor_price::text" as const

/** Tables whose amount columns must be read as text. */
export const WEI_TABLES = ["listings", "token_bids", "collection_bids", "collections"] as const

/** Selects that never contain an amount column are fine; amount columns must carry ::text. */
export const AMOUNT_COLUMNS = ["price", "floor_price", "total_volume"] as const

/** Row shapes as read through the column lists above (amounts are text). */
export type ListingRowText = Omit<Tables<"listings">, "price"> & { price: string }
export type TokenBidRowText = Omit<Tables<"token_bids">, "price"> & { price: string | null }
export type CollectionBidRowText = Omit<Tables<"collection_bids">, "price"> & { price: string | null }
export type CollectionRowText = Omit<Tables<"collections">, "floor_price" | "total_volume"> & {
  /** wei, decimal-integer text */
  floor_price: string | null
  /** ether, decimal text (indexer accumulates wei * 1e-18) */
  total_volume: string | null
}
