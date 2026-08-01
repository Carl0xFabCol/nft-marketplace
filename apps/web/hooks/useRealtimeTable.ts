"use client"

import { supabase } from "@/lib/supabase/client"
import { useEffect, useRef } from "react"

// hooks/useRealtimeTable.ts
//
// Generic Supabase Realtime backbone. Subscribes to `postgres_changes` on any
// table and forwards INSERT / UPDATE / DELETE payloads to the caller. This is
// the shared engine behind listings, token bids and collection bids; it's the
// only mechanism that reflects *indexer* writes without polling.
//
// `onChange` is held in a ref so the subscription is created once per
// (table, filter) instead of being torn down/recreated on every parent render.

export type RealtimeTableName = "listings" | "token_bids" | "collection_bids"

export interface RealtimeChange<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE"
  new?: T
  old?: T
}

export interface UseRealtimeTableOptions<T> {
  /** The table to subscribe to. */
  table: RealtimeTableName
  /** postgres_changes filter, e.g. `seller_wallet=eq.0x123…`. Omit to receive all rows. */
  filter?: string
  /** When false, no subscription is created (e.g. no wallet connected yet). */
  enabled?: boolean
  /** Called with every INSERT / UPDATE / DELETE payload. */
  onChange: (change: RealtimeChange<T>) => void
  /** Stable channel key; defaults to `realtime-<table>-<filter>`. */
  channelKey?: string
}

export function useRealtimeTable<T>({ table, filter, enabled = true, onChange, channelKey }: UseRealtimeTableOptions<T>) {
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
          onChangeRef.current({
            eventType: payload.eventType,
            new: payload.new as T | undefined,
            old: payload.old as T | undefined,
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, filter, enabled, channelKey])
}
