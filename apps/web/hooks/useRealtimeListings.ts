"use client"

import { supabase } from "@/lib/supabase/client"
import { useEffect, useRef } from "react"
import { Address } from "viem"
import { toUserListing, RealtimeListingRow } from "@/lib/listingMerge"
import { UserListing } from "@/types/user.types"

// hooks/useRealtimeListings.ts
//
// Backbone of the listing state propagation. Subscribes to Supabase Realtime
// `postgres_changes` on the `listings` table, filtered to the page owner's
// listings, and forwards every DB write (optimistic insert, indexer
// confirmation, price update, delist, sale) to the caller. This is the only
// mechanism that reflects *indexer* writes without polling.
//
// Callbacks are held in refs so the subscription is created once per address
// instead of being torn down/recreated on every `nfts` change.

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
  const onUpsertRef = useRef(onUpsert)
  const onDeactivateRef = useRef(onDeactivate)

  useEffect(() => {
    onUpsertRef.current = onUpsert
    onDeactivateRef.current = onDeactivate
  }, [onUpsert, onDeactivate])

  useEffect(() => {
    const filter = collectionAddress
      ? `collection_address=eq.${collectionAddress.toLowerCase()}`
      : userAddress
        ? `seller_wallet=eq.${userAddress.toLowerCase()}`
        : null
    if (!filter) return

    const channel = supabase
      .channel(`realtime-listings-${filter.replace(/[^a-z0-9]/gi, "")}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "listings",
          filter,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            if (payload.old) onDeactivateRef.current(toUserListing(payload.old as RealtimeListingRow))
            return
          }

          const row = payload.new as RealtimeListingRow | undefined
          if (!row) return

          const listing = toUserListing(row)
          if (row.is_active) onUpsertRef.current(listing)
          else onDeactivateRef.current(listing)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userAddress, collectionAddress])
}
