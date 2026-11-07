// ─────────────────────────────────────────────────────────────────────────────
// Test helper: a tiny in-memory model of the tables the indexer writes, driven
// by the query chains recorded by createRecordingSupabase. It implements only
// what the repositories use: upsert(onConflict, ignoreDuplicates), insert with
// the relevant unique keys, update/delete/select with .eq filters, .single(),
// and the additive increment_collection_stats RPC.
//
// Unique keys mirror the Phase 1+2 schema:
//   activity      (tx_hash, log_index)            via upsert onConflict
//   listings      (chain_id, collection_address, token_id)
//   nfts          (collection_address, token_id, chain_id)
//   collections   (chain_id, contract_address)
//   token_bids / collection_bids: NO on-chain identity unique yet (IDX-7, 3B)
// ─────────────────────────────────────────────────────────────────────────────
import { formatEther, parseEther } from "viem"
import { createRecordingSupabase, type RecordedQuery, type RecordedRpc } from "./recordingSupabase"

type Row = Record<string, unknown>

const INSERT_UNIQUES: Record<string, string[]> = {
  nfts: ["collection_address", "token_id", "chain_id"],
  listings: ["chain_id", "collection_address", "token_id"],
  collections: ["chain_id", "contract_address"],
}

export function createMemoryDb() {
  const tables: Record<string, Row[]> = {}
  const table = (name: string) => (tables[name] ??= [])
  const clone = (r: Row) => ({ ...r })

  function filtersOf(q: RecordedQuery): [string, unknown][] {
    return q.ops.filter((o) => o.method === "eq").map((o) => [o.args[0] as string, o.args[1]])
  }
  const matches = (row: Row, filters: [string, unknown][]) => filters.every(([k, v]) => row[k] === v)
  const sameKey = (a: Row, b: Row, keys: string[]) => keys.every((k) => a[k] === b[k])

  function responder(q: RecordedQuery): { data: unknown; error: unknown } {
    const rows = table(q.table)
    const filters = filtersOf(q)
    const op = (m: string) => q.ops.find((o) => o.method === m)

    const upsert = op("upsert")
    if (upsert) {
      const row = upsert.args[0] as Row
      const opts = (upsert.args[1] ?? {}) as { onConflict?: string; ignoreDuplicates?: boolean }
      const keys = (opts.onConflict ?? "id").split(",")
      const existing = rows.find((r) => sameKey(r, row, keys))
      if (existing) {
        if (opts.ignoreDuplicates) return { data: [], error: null }
        Object.assign(existing, row)
        return { data: [clone(existing)], error: null }
      }
      rows.push(clone(row))
      return { data: [clone(row)], error: null }
    }

    const insert = op("insert")
    if (insert) {
      const row = insert.args[0] as Row
      const keys = INSERT_UNIQUES[q.table]
      if (keys && rows.some((r) => sameKey(r, row, keys))) {
        return { data: null, error: { code: "23505", message: `duplicate key on ${q.table}` } }
      }
      rows.push(clone(row))
      return { data: [clone(row)], error: null }
    }

    const update = op("update")
    if (update) {
      const hit = rows.filter((r) => matches(r, filters))
      for (const r of hit) Object.assign(r, update.args[0] as Row)
      return { data: hit.map(clone), error: null }
    }

    if (op("delete")) {
      const keep = rows.filter((r) => !matches(r, filters))
      tables[q.table] = keep
      return { data: null, error: null }
    }

    const hit = rows.filter((r) => matches(r, filters))
    if (op("single")) {
      return hit.length === 1 ? { data: clone(hit[0]), error: null } : { data: null, error: { code: "PGRST116", message: `${hit.length} rows` } }
    }
    return { data: hit.map(clone), error: null }
  }

  /** increment_collection_stats(text, numeric, integer): additive, matched by address only (like the live RPC). */
  function rpcResponder(call: RecordedRpc): { data: unknown; error: unknown } {
    if (call.fn !== "increment_collection_stats") return { data: null, error: { message: `unknown rpc ${call.fn}` } }
    for (const c of table("collections").filter((r) => r.contract_address === call.args.p_collection_address)) {
      const volumeWei = parseEther(String(c.total_volume ?? "0")) + parseEther(String(call.args.p_volume))
      c.total_volume = formatEther(volumeWei)
      c.total_sales = Number(c.total_sales ?? 0) + Number(call.args.p_sales)
    }
    return { data: null, error: null }
  }

  const sb = createRecordingSupabase(responder)
  sb.setRpcResponder(rpcResponder)

  return {
    sb,
    tables,
    /** Deterministic JSON snapshot of the given tables (row order preserved). */
    snapshot(names: string[]): string {
      return JSON.stringify(names.map((n) => [n, tables[n] ?? []]))
    },
  }
}
