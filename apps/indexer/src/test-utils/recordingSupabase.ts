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
