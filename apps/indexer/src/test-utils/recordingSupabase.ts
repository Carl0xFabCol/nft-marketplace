// ─────────────────────────────────────────────────────────────────────────────
// Test helper: a chainable fake of the supabase-js query builder that records
// every call. It lets tests run the REAL repositories and assert the exact
// PostgREST payloads they send, with no network and no database.
// ─────────────────────────────────────────────────────────────────────────────

export interface RecordedOp {
  method: string
  args: unknown[]
}

export interface RecordedQuery {
  table: string
  ops: RecordedOp[]
}

export interface RecordedRpc {
  fn: string
  args: Record<string, unknown>
}

export type Responder = (query: RecordedQuery) => { data: unknown; error: unknown }

const CHAIN_METHODS = ["select", "insert", "upsert", "update", "delete", "eq", "neq", "lt", "lte", "gt", "gte", "in", "is", "or", "order", "limit", "single", "maybeSingle"]

export function createRecordingSupabase(responder: Responder = () => ({ data: null, error: null })) {
  const queries: RecordedQuery[] = []
  const rpcs: RecordedRpc[] = []
  let rpcResponder: (call: RecordedRpc) => { data: unknown; error: unknown } = () => ({ data: null, error: null })

  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, ops: [] }
      queries.push(query)
      const builder: Record<string, unknown> = {}
      for (const method of CHAIN_METHODS) {
        builder[method] = (...args: unknown[]) => {
          query.ops.push({ method, args })
          return builder
        }
      }
      builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(responder(query)).then(resolve, reject)
        } catch (error) {
          return Promise.reject(error).then(resolve, reject)
        }
      }
      return builder
    },
    rpc(fn: string, args: Record<string, unknown>) {
      const call = { fn, args }
      rpcs.push(call)
      return Promise.resolve(rpcResponder(call))
    },
  }

  return {
    client: client as never,
    queries,
    rpcs,
    setRpcResponder(fn: typeof rpcResponder) {
      rpcResponder = fn
    },
    /** First argument of every `method` call on `table` (e.g. the upsert payloads of "listings"). */
    payloads(table: string, method: string): Record<string, unknown>[] {
      return queries
        .filter((q) => q.table === table)
        .flatMap((q) => q.ops.filter((o) => o.method === method).map((o) => o.args[0] as Record<string, unknown>))
    },
  }
}

export function hasOp(query: RecordedQuery, method: string): boolean {
  return query.ops.some((o) => o.method === method)
}

/**
 * Responder that models the activity unique key (tx_hash, log_index): an
 * activity upsert returns the inserted row the first time and nothing on a
 * duplicate, exactly like ON CONFLICT DO NOTHING RETURNING. A delete on
 * activity removes the key again.
 */
export function activityUniqueResponder(): Responder {
  const seen = new Set<string>()
  return (q) => {
    if (q.table !== "activity") return { data: null, error: null }
    const upsert = q.ops.find((o) => o.method === "upsert")
    if (upsert) {
      const row = upsert.args[0] as { tx_hash: string; log_index: number }
      const key = `${row.tx_hash}:${row.log_index}`
      if (seen.has(key)) return { data: [], error: null }
      seen.add(key)
      return { data: [{ id: key }], error: null }
    }
    if (q.ops.some((o) => o.method === "delete")) {
      const eqs = q.ops.filter((o) => o.method === "eq")
      const tx = eqs.find((o) => o.args[0] === "tx_hash")?.args[1]
      const li = eqs.find((o) => o.args[0] === "log_index")?.args[1]
      seen.delete(`${tx}:${li}`)
    }
    return { data: null, error: null }
  }
}
