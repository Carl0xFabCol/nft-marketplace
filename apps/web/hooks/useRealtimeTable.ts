"use client"

import { supabase } from "@/lib/supabase/client"
import { useEffect, useRef } from "react"
import { realtimeChangeMatchesChain, type RealtimeChange } from "@/lib/realtimeChain"

// hooks/useRealtimeTable.ts
//
// Generic Supabase Realtime backbone. Subscribes to `postgres_changes` on any
// table and forwards INSERT / UPDATE / DELETE payloads to the caller. This is
// the shared engine behind listings, token bids and collection bids; it's the
// only mechanism that reflects *indexer* writes without polling.
//
// Chain scoping: postgres_changes allows a single column filter, which callers
// spend on wallet/collection. Every payload is therefore checked against the
// page's data chain here, in the one place all realtime rows pass through; a
// row that does not explicitly carry that chain (including column-filtered or
// key-only DELETE payloads) is dropped rather than merged.
//
// `onChange` is held in a ref so the subscription is created once per
// (table, filter) instead of being torn down/recreated on every parent render.

export type RealtimeTableName = "listings" | "token_bids" | "collection_bids"

export type { RealtimeChange } from "@/lib/realtimeChain"

export interface UseRealtimeTableOptions<T> {
  /** The table to subscribe to. */
  table: RealtimeTableName
  /** The page's data chain; rows from any other chain are dropped. */
  chainId: number
  /** postgres_changes filter, e.g. `seller_wallet=eq.0x123…`. Omit to receive all rows. */
  filter?: string
  /** When false, no subscription is created (e.g. no wallet connected yet). */
  enabled?: boolean
  /** Called with every INSERT / UPDATE / DELETE payload. */
  onChange: (change: RealtimeChange<T>) => void
  /** Stable channel key; defaults to `realtime-<table>-<filter>`. */
  channelKey?: string
}

export function useRealtimeTable<T>({ table, chainId, filter, enabled = true, onChange, channelKey }: UseRealtimeTableOptions<T>) {
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!enabled) return

    const f = filter?.trim() || undefined
    const key = channelKey ?? `realtime-${table}-${f ? f.replace(/[^a-z0-9]/gi, "") : "all"}`

    const channel = supabase
      .channel(key)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          ...(f ? { filter: f } : {}),
        },
        (payload) => {
          const change: RealtimeChange<T> = {
            eventType: payload.eventType,
            new: payload.new as T | undefined,
            old: payload.old as T | undefined,
          }
          if (realtimeChangeMatchesChain(change, chainId)) onChangeRef.current(change)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, chainId, filter, enabled, channelKey])
}
