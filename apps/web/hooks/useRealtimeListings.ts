"use client"

import { Address } from "viem"
import { useRealtimeTable } from "@/hooks/useRealtimeTable"
import { toUserListing, RealtimeListingRow } from "@/lib/listingMerge"
import { UserListing } from "@/types/user.types"

// hooks/useRealtimeListings.ts
//
// Listings-specific wrapper over the generic `useRealtimeTable` backbone.
// Subscribes to `postgres_changes` on the `listings` table, filtered to the
// page owner's listings, and forwards every DB write (optimistic insert,
// indexer confirmation, price update, delist, sale) to the caller. Kept for
// the two existing callers (user portfolio + collection page) so they don't
// have to think about the generic payload shape.

export interface UseRealtimeListingsOptions {
  /** Filter by seller wallet — the user portfolio page. */
  userAddress?: Address
  /** Filter by collection — the collection page. */
  collectionAddress?: Address
  /** INSERT or UPDATE with `is_active = true` (new listing, price change, pending → confirmed). */
  onUpsert: (listing: UserListing) => void
  /** UPDATE with `is_active = false` or DELETE (delist, sale, cancelled). */
  onDeactivate: (listing: UserListing) => void
}

export function useRealtimeListings({ userAddress, collectionAddress, onUpsert, onDeactivate }: UseRealtimeListingsOptions) {
  const filter = collectionAddress
    ? `collection_address=eq.${collectionAddress.toLowerCase()}`
    : userAddress
      ? `seller_wallet=eq.${userAddress.toLowerCase()}`
      : null

  useRealtimeTable<RealtimeListingRow>({
    table: "listings",
    filter: filter ?? undefined,
    enabled: Boolean(filter),
    onChange: (change) => {
      if (change.eventType === "DELETE") {
        if (change.old) onDeactivate(toUserListing(change.old))
        return
      }

      const row = change.new
      if (!row) return

      const listing = toUserListing(row)
      if (row.is_active) onUpsert(listing)
      else onDeactivate(listing)
    },
  })
}
