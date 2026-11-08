// lib/realtimeChain.ts
// Pure chain check applied to every Supabase Realtime payload (see
// hooks/useRealtimeTable.ts). Fail closed: a row must carry the page's chain.

export interface RealtimeChange<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE"
  new?: T
  old?: T
}

function rowChain(row: unknown): unknown {
  return row && typeof row === "object" ? (row as { chain_id?: unknown }).chain_id : undefined
}

export function realtimeChangeMatchesChain<T>(change: RealtimeChange<T>, chainId: number): boolean {
  const row = change.eventType === "DELETE" ? change.old : change.new
  // chain_id may arrive as a number or (numeric columns) a string.
  const c = rowChain(row)
  return c !== undefined && c !== null && Number(c) === chainId && String(c) === String(chainId)
}
