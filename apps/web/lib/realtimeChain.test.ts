import { describe, expect, it } from "vitest"
import { realtimeChangeMatchesChain } from "./realtimeChain"

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
