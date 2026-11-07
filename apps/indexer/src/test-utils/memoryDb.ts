// ─────────────────────────────────────────────────────────────────────────────
// Test helper: a tiny in-memory model of the tables the indexer writes, driven
// by the query chains recorded by createRecordingSupabase. It implements only
// what the repositories use: upsert(onConflict, ignoreDuplicates), insert with
// the relevant unique keys, update/delete/select with .eq filters, .single(),
// and the indexer_record_sale RPC (atomic, idempotent sale + stats).
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

  /** Set to make the next RPC call fail before it changes anything (atomic, like a rolled-back transaction). */
  let failNextRpc: string | null = null

  /**
   * indexer_record_sale (migration 20261028091200): inserts the SALE activity
   * row unless (tx_hash, log_index) exists, and only then adds wei/1e18 to
   * total_volume and 1 to total_sales of (chain_id, contract_address).
   */
  function rpcResponder(call: RecordedRpc): { data: unknown; error: unknown } {
    if (failNextRpc) {
      const message = failNextRpc
      failNextRpc = null
      return { data: null, error: { message } }
    }
    if (call.fn === "indexer_record_sale") {
      const a = call.args
      const activity = table("activity")
      if (activity.some((r) => r.tx_hash === a.p_tx_hash && r.log_index === a.p_log_index)) return { data: false, error: null }
      activity.push({
        event: "SALE",
        chain_id: a.p_chain_id,
        collection_address: a.p_collection_address,
        token_id: a.p_token_id,
        from: a.p_from,
        to: a.p_to,
        price: a.p_price_wei,
        tx_hash: a.p_tx_hash,
        created_at: a.p_created_at,
        log_index: a.p_log_index,
        source_contract: a.p_source_contract,
      })
      for (const c of table("collections").filter((r) => r.chain_id === a.p_chain_id && r.contract_address === a.p_collection_address)) {
        const volumeWei = parseEther(String(c.total_volume ?? "0")) + BigInt(String(a.p_price_wei))
        c.total_volume = formatEther(volumeWei)
        c.total_sales = Number(c.total_sales ?? 0) + 1
      }
      return { data: true, error: null }
    }
    return { data: null, error: { message: `unknown rpc ${call.fn}` } }
  }

  const sb = createRecordingSupabase(responder)
  sb.setRpcResponder(rpcResponder)

  return {
    sb,
    tables,
    /** Make the next RPC call fail with `message`, changing nothing. */
    failNextRpc(message: string) {
      failNextRpc = message
    },
    /** Deterministic JSON snapshot of the given tables (row order preserved). */
    snapshot(names: string[]): string {
      return JSON.stringify(names.map((n) => [n, tables[n] ?? []]))
    },
  }
}
