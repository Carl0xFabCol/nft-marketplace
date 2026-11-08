// lib/realtimeChain.ts
// Pure steps applied to every Supabase Realtime payload (see
// hooks/useRealtimeTable.ts):
//  1. chain check: a row must carry the page's chain (fail closed);
//  2. exact re-read: realtime serializes numeric columns as JSON numbers, which
//     round above 2^53, so an INSERT/UPDATE row is re-fetched by (id, chain_id)
//     through the text-cast column lists before anything is merged.

import { COLLECTION_BID_COLUMNS, LISTING_COLUMNS, TOKEN_BID_COLUMNS } from "@/lib/supabase/columns"

export type RealtimeTableName = "listings" | "token_bids" | "collection_bids"

export interface RealtimeChange<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE"
  new?: T
  old?: T
}

/** Exact (text-cast) select list per realtime table. */
export const REALTIME_COLUMNS: Record<RealtimeTableName, string> = {
  listings: LISTING_COLUMNS,
  token_bids: TOKEN_BID_COLUMNS,
  collection_bids: COLLECTION_BID_COLUMNS,
}

/** Reads one row by id on one chain with REALTIME_COLUMNS[table]; null if absent. */
export type ExactRowFetcher = (table: RealtimeTableName, id: string, chainId: number) => Promise<Record<string, unknown> | null>

function rowChain(row: unknown): unknown {
  return row && typeof row === "object" ? (row as { chain_id?: unknown }).chain_id : undefined
}

export function realtimeChangeMatchesChain<T>(change: RealtimeChange<T>, chainId: number): boolean {
  const row = change.eventType === "DELETE" ? change.old : change.new
  // chain_id may arrive as a number or a string.
  const c = rowChain(row)
  return c !== undefined && c !== null && Number(c) === chainId && String(c) === String(chainId)
}

/**
 * Replace the payload row of an INSERT/UPDATE with the exact DB row. DELETE
 * passes through (its key-only `old` carries no amounts). Returns null (drop
 * the event) when the row has no id, vanished, or moved off this chain.
 */
export async function toExactChange<T>(change: RealtimeChange<T>, table: RealtimeTableName, chainId: number, fetchRow: ExactRowFetcher): Promise<RealtimeChange<T> | null> {
  if (change.eventType === "DELETE") return change
  const id = (change.new as { id?: unknown } | undefined)?.id
  if (typeof id !== "string" || id === "") return null
  const row = await fetchRow(table, id, chainId)
  if (!row || !realtimeChangeMatchesChain({ eventType: change.eventType, new: row }, chainId)) return null
  return { ...change, new: row as T }
}
