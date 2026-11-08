import { describe, expect, it } from "vitest"
import { aggregateSales24h } from "./collections.service"

describe("aggregateSales24h (bigint, per collection)", () => {
  it("sums wei exactly and ranks by volume", () => {
    const A = "0x00000000000000000000000000000000000000aa"
    const B = "0x00000000000000000000000000000000000000bb"
    const out = aggregateSales24h([
      { collection_address: A, price: "9007199254740993" }, // 2^53 + 1
      { collection_address: A.toUpperCase().replace("0X", "0x"), price: "9007199254740993" },
      { collection_address: B, price: "18014398509481987" },
      { collection_address: null, price: "1" },
      { collection_address: B, price: "not-a-number" },
    ])
    expect(out).toEqual([
      { collection_address: B, volume_wei: "18014398509481987", sales: 1 },
      { collection_address: A, volume_wei: "18014398509481986", sales: 2 },
    ])
  })

  it("keeps the top N with a deterministic tie-break", () => {
    const rows = ["c", "a", "b"].map((x) => ({ collection_address: `0x${x.repeat(40)}`, price: "1" }))
    expect(aggregateSales24h(rows, 2).map((r) => r.collection_address)).toEqual([`0x${"a".repeat(40)}`, `0x${"b".repeat(40)}`])
  })
})
