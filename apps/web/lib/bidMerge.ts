// lib/bidMerge.ts
//
// Pure helpers for merging `token_bids` / `collection_bids` DB state into
// client bid lists, mirroring lib/listingMerge.ts for listings. Used by the
// realtime backbone (hooks/useRealtimeTable.ts) on the bid surfaces. All
// helpers are idempotent by bid `id`: applying the same event twice produces
// the same result.

import { UserTokenBid, UserCollectionBid } from "@/types/user.types"

// A row from `token_bids` / `collection_bids` as delivered by Supabase
// Realtime. Fields are optional because the `supabase_realtime` publication
// may be configured with column filtering (only a subset of columns is
// broadcast).
export type RealtimeTokenBidRow = {
  id?: string
  bidder_wallet?: string | null
  collection_address?: string | null
  created_at?: string
  expires_at?: string | null
  is_active?: boolean | null
  price?: number | null
  seller_wallet?: string | null
  token_id?: string | null
  updated_at?: string | null
}

export type RealtimeCollectionBidRow = {
  id?: string
  bidder_wallet?: string
  collection_address?: string | null
  created_at?: string
  expires_at?: string | null
  is_active?: boolean | null
  price?: number | null
  quantity?: number | null
  seller_wallet?: string | null
  updated_at?: string | null
}

/** Normalize a (possibly column-filtered) realtime token-bid row. */
export function toUserTokenBid(row: RealtimeTokenBidRow): UserTokenBid {
  return {
    id: row.id ?? "",
    bidder_wallet: row.bidder_wallet ?? null,
    collection_address: row.collection_address ?? null,
    created_at: row.created_at ?? new Date().toISOString(),
    expires_at: row.expires_at ?? null,
    is_active: row.is_active ?? true,
    price: row.price ?? null,
    seller_wallet: row.seller_wallet ?? null,
    token_id: row.token_id ?? null,
    updated_at: row.updated_at ?? null,
  }
}

/** Normalize a (possibly column-filtered) realtime collection-bid row. */
export function toUserCollectionBid(row: RealtimeCollectionBidRow): UserCollectionBid {
  return {
    id: row.id ?? "",
    bidder_wallet: row.bidder_wallet ?? "",
    collection_address: row.collection_address ?? null,
    created_at: row.created_at ?? new Date().toISOString(),
    expires_at: row.expires_at ?? null,
    is_active: row.is_active ?? true,
    price: row.price ?? null,
    quantity: row.quantity ?? null,
    seller_wallet: row.seller_wallet ?? null,
    updated_at: row.updated_at ?? null,
  }
}

/** Upsert a token bid by `id` (new bid, or an indexer UPDATE). */
export function upsertTokenBid(bids: UserTokenBid[], bid: UserTokenBid): UserTokenBid[] {
  const idx = bids.findIndex((b) => b.id === bid.id)
  if (idx === -1) return [...bids, bid]
  const copy = [...bids]
  copy[idx] = bid
  return copy
}

/** Remove a cancelled / accepted token bid. */
export function deactivateTokenBid(bids: UserTokenBid[], bid: UserTokenBid): UserTokenBid[] {
  return bids.filter((b) => b.id !== bid.id)
}

/** Upsert a collection bid by `id` (new bid, or an indexer UPDATE). */
export function upsertCollectionBid(bids: UserCollectionBid[], bid: UserCollectionBid): UserCollectionBid[] {
  const idx = bids.findIndex((b) => b.id === bid.id)
  if (idx === -1) return [...bids, bid]
  const copy = [...bids]
  copy[idx] = bid
  return copy
}

/** Remove a cancelled / accepted collection bid. */
export function deactivateCollectionBid(bids: UserCollectionBid[], bid: UserCollectionBid): UserCollectionBid[] {
  return bids.filter((b) => b.id !== bid.id)
}
