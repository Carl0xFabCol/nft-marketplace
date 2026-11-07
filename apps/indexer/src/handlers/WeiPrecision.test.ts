// Test #12 (INTEGRATION_AUDIT §10, IDX-4): wei survives handler -> repository
// -> PostgREST payload unchanged. 1234567890123456789 > 2^53, so any Number()
// on the path would round it to 1234567890123456800.
import { describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({ env: { chainId: 99801 } }))

import { BUYER, COLLECTION, SELLER, buildHarness, makeEvent } from "../test-utils/harness"

const WEI = 1234567890123456789n

describe("test #12: wei precision round-trip (IDX-4)", () => {
  it("is not exactly representable as a double (guards the test itself)", () => {
    expect(BigInt(Number(WEI))).not.toBe(WEI)
  })

  it("ListingCreated / ListingUpdated send the exact decimal string to listings.price", async () => {
    const { sb, registry } = buildHarness()
    await registry.dispatch(makeEvent("core", "ListingCreated", { collection: COLLECTION, tokenId: 7n, seller: SELLER, price: WEI, expiresAt: 0n }))
    await registry.dispatch(makeEvent("core", "ListingUpdated", { collection: COLLECTION, tokenId: 7n, newPrice: WEI + 1n }))

    const [upserted] = sb.payloads("listings", "upsert")
    expect(upserted.price).toBe("1234567890123456789")
    expect(BigInt(upserted.price as string)).toBe(WEI)

    const [updated] = sb.payloads("listings", "update")
    expect(updated.price).toBe("1234567890123456790")
    expect(BigInt(updated.price as string)).toBe(WEI + 1n)

    for (const a of sb.payloads("activity", "upsert")) expect(BigInt(a.price as string) - WEI <= 1n).toBe(true)
  })

  it("TokenBidPlaced / CollectionBidPlaced send the exact decimal string to *_bids.price", async () => {
    const { sb, registry } = buildHarness()
    await registry.dispatch(makeEvent("bids", "TokenBidPlaced", { collection: COLLECTION, tokenId: 7n, bidder: BUYER, price: WEI, expiresAt: 0n }))
    await registry.dispatch(makeEvent("bids", "CollectionBidPlaced", { collection: COLLECTION, bidder: BUYER, pricePerItem: WEI, quantity: 3n, expiresAt: 0n }))

    const [tokenBid] = sb.payloads("token_bids", "insert")
    expect(tokenBid.price).toBe("1234567890123456789")
    const [collectionBid] = sb.payloads("collection_bids", "insert")
    expect(collectionBid.price).toBe("1234567890123456789")
    expect(collectionBid.quantity).toBe(3)
  })

  it("Sale sends exact activity price and an exact ether decimal to increment_collection_stats", async () => {
    const { sb, registry } = buildHarness((q) =>
      // The activity upsert returns the inserted row (fresh insert).
      q.table === "activity" ? { data: [{ id: "a1" }], error: null } : { data: null, error: null },
    )
    await registry.dispatch(
      makeEvent("core", "Sale", { collection: COLLECTION, tokenId: 7n, seller: SELLER, buyer: BUYER, price: WEI, marketplaceFeeAmount: 0n, royaltyAmount: 0n }),
    )

    const [activity] = sb.payloads("activity", "upsert")
    expect(activity.price).toBe("1234567890123456789")
    expect(sb.rpcs).toEqual([
      { fn: "increment_collection_stats", args: { p_collection_address: COLLECTION, p_volume: "1.234567890123456789", p_sales: 1 } },
    ])
  })
})

describe("IDX-4 guard: no Number() on wei in handlers or repositories", () => {
  it("source files never coerce a price/amount identifier through Number()", async () => {
    const { readdirSync, readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const dirs = ["../handlers/", "../persistence/"].map((d) => fileURLToPath(new URL(d, import.meta.url)))
    const offenders: string[] = []
    for (const dir of dirs) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
        readFileSync(dir + file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (/Number\(\s*[\w.]*(price|Price|amount|Amount|volume|Volume|wei|Wei)\w*\s*\)|\/\s*1e18/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
          })
      }
    }
    expect(offenders).toEqual([])
  })
})
