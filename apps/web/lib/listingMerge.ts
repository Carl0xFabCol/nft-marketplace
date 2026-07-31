// lib/listingMerge.ts
//
// Pure helpers for merging `listings` DB state into client UI state.
// Used by the realtime backbone (hooks/useRealtimeListings.ts) and the
// optimistic local patches (list/delist flows). Everything here is idempotent:
// applying an event twice produces the same result, so the optimistic patch
// and the later realtime event are never racy — the later event simply
// overwrites with the newer row (both carry the same DB truth).
import { Address } from "viem"
import { EnrichedUserNFT, UserListing } from "@/types/user.types"

// A row from the `listings` table as delivered by Supabase Realtime.
// Fields are optional because the `supabase_realtime` publication may be
// configured with column filtering (only a subset of columns is broadcast).
export type RealtimeListingRow = {
  id?: string
  listing_id?: string | null
  collection_address: string
  token_id: string
  seller_wallet?: string | null
  buyer_wallet?: string | null
  price?: number | string | null
  is_active?: boolean
  chain_id?: number | null
  listed_at?: string | null
  expires_at?: string | null
  tx_hash?: string | null
  created_at?: string
  updated_at?: string | null
  status?: string | null
  source?: string | null
}

/** Normalize a realtime row (possibly column-filtered) into a UserListing. */
export function toUserListing(row: RealtimeListingRow): UserListing {
  const rawPrice = row.price ?? 0

  return {
    id: row.id ?? "",
    listing_id: row.listing_id ?? null,
    collection_address: row.collection_address.toLowerCase(),
    token_id: String(row.token_id),
    seller_wallet: row.seller_wallet?.toLowerCase() ?? null,
    buyer_wallet: row.buyer_wallet?.toLowerCase() ?? null,
    price: typeof rawPrice === "string" ? Number(rawPrice) : rawPrice,
    is_active: row.is_active ?? true,
    chain_id: row.chain_id ?? null,
    listed_at: row.listed_at ?? null,
    expires_at: row.expires_at ?? null,
    tx_hash: row.tx_hash ?? "",
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? null,
    status: row.status ?? null,
    source: row.source ?? null,
  }
}

const listingKey = (collectionAddress: string, tokenId: string) => `${collectionAddress.toLowerCase()}-${String(tokenId)}`

/**
 * Set/overwrite `active_listing` for the matching NFT (INSERT / price change /
 * pending → confirmed).
 */
export function upsertListingIntoNfts(nfts: EnrichedUserNFT[], listing: UserListing): EnrichedUserNFT[] {
  const key = listingKey(listing.collection_address, listing.token_id)
  return nfts.map((nft) => (listingKey(nft.collection_address, nft.token_id) === key ? { ...nft, active_listing: listing } : nft))
}

/**
 * Clear `active_listing` for the matching NFT (delist or sale). If the row
 * records a buyer, the NFT also changes owner (sale).
 */
export function deactivateListingInNfts(nfts: EnrichedUserNFT[], listing: UserListing): EnrichedUserNFT[] {
  const key = listingKey(listing.collection_address, listing.token_id)
  return nfts.map((nft) => {
    if (listingKey(nft.collection_address, nft.token_id) !== key) return nft
    if (listing.buyer_wallet && listing.buyer_wallet.toLowerCase() !== nft.owner_wallet?.toLowerCase()) {
      return { ...nft, active_listing: null, owner_wallet: listing.buyer_wallet as Address }
    }
    return { ...nft, active_listing: null }
  })
}

/** Upsert into a flat listings array (used for the floor column). */
export function upsertListingIntoListings(listings: UserListing[], listing: UserListing): UserListing[] {
  const key = listingKey(listing.collection_address, listing.token_id)
  const idx = listings.findIndex((l) => listingKey(l.collection_address, l.token_id) === key)
  if (idx === -1) return [...listings, listing]
  const copy = [...listings]
  copy[idx] = listing
  return copy
}

/** Remove a deactivated listing from a flat listings array. */
export function deactivateListingInListings(listings: UserListing[], listing: UserListing): UserListing[] {
  const key = listingKey(listing.collection_address, listing.token_id)
  return listings.filter((l) => listingKey(l.collection_address, l.token_id) !== key)
}
