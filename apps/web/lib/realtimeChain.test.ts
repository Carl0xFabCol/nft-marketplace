import { describe, expect, it } from "vitest"
import { REALTIME_COLUMNS, realtimeChangeMatchesChain, toExactChange } from "./realtimeChain"

describe("realtimeChangeMatchesChain", () => {
  it("accepts only rows that carry the page chain", () => {
    expect(realtimeChangeMatchesChain({ eventType: "INSERT", new: { chain_id: 99801 } }, 99801)).toBe(true)
    expect(realtimeChangeMatchesChain({ eventType: "UPDATE", new: { chain_id: "99801" } }, 99801)).toBe(true)
    expect(realtimeChangeMatchesChain({ eventType: "INSERT", new: { chain_id: 11155111 } }, 99801)).toBe(false)
  })

  it("drops ambiguous rows (missing chain, column-filtered, key-only DELETE)", () => {
    expect(realtimeChangeMatchesChain({ eventType: "INSERT", new: { id: "x" } }, 99801)).toBe(false)
    expect(realtimeChangeMatchesChain({ eventType: "UPDATE", new: { chain_id: null } }, 99801)).toBe(false)
    expect(realtimeChangeMatchesChain({ eventType: "DELETE", old: { id: "x" } }, 99801)).toBe(false)
    expect(realtimeChangeMatchesChain({ eventType: "DELETE", old: { chain_id: 99801 } }, 99801)).toBe(true)
    expect(realtimeChangeMatchesChain({ eventType: "UPDATE", new: { chain_id: "99801.0" } }, 99801)).toBe(false)
  })
})

describe("toExactChange (realtime rows re-read through price::text)", () => {
  const exact = { id: "a", chain_id: 99801, price: "1234567890123456789", is_active: true }
  const fetcher = (row: Record<string, unknown> | null) => {
    const calls: unknown[][] = []
    const fn = async (...args: unknown[]) => {
      calls.push(args)
      return row
    }
    return Object.assign(fn, { calls })
  }

  it("replaces a lossy JSON-number payload with the exact row", async () => {
    const f = fetcher(exact)
    const out = await toExactChange({ eventType: "UPDATE", new: { id: "a", chain_id: 99801, price: 1234567890123456800 } }, "listings", 99801, f)
    expect(out?.new).toEqual(exact)
    expect(f.calls).toEqual([["listings", "a", 99801]])
  })

  it("drops events without id, vanished rows and rows that moved chain", async () => {
    expect(await toExactChange({ eventType: "INSERT", new: { chain_id: 99801 } }, "token_bids", 99801, fetcher(exact))).toBeNull()
    expect(await toExactChange({ eventType: "INSERT", new: { id: "a", chain_id: 99801 } }, "token_bids", 99801, fetcher(null))).toBeNull()
    expect(await toExactChange({ eventType: "INSERT", new: { id: "a", chain_id: 99801 } }, "token_bids", 99801, fetcher({ ...exact, chain_id: 1 }))).toBeNull()
  })

  it("passes DELETE through without a read", async () => {
    const f = fetcher(exact)
    const del = { eventType: "DELETE" as const, old: { id: "a", chain_id: 99801 } }
    expect(await toExactChange(del, "collection_bids", 99801, f)).toBe(del)
    expect(f.calls).toEqual([])
  })

  it("re-reads every realtime table through its text-cast columns", () => {
    for (const cols of Object.values(REALTIME_COLUMNS)) expect(cols).toContain("price::text")
  })
})
