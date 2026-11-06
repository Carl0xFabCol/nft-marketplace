import { describe, expect, it } from "vitest"
import { buildListingId, normalizeChainId, normalizeCollectionAddress, normalizeTokenId, tryNormalizeTokenId } from "./listingIdentity"

const collection = "0x880176caEd2C38F889e5E0AD6Ae55A871dd0f3B5"

describe("listingIdentity", () => {
  it("canonicalizes token ids", () => {
    expect(normalizeTokenId("0")).toBe("0")
    expect(normalizeTokenId("000")).toBe("0")
    expect(normalizeTokenId("01")).toBe("1")
    expect(normalizeTokenId("000123")).toBe("123")
    expect(tryNormalizeTokenId("not-a-number")).toBeNull()
  })

  it("canonicalizes collection addresses", () => {
    expect(normalizeCollectionAddress(collection)).toBe(collection.toLowerCase())
    expect(() => normalizeCollectionAddress("0x123")).toThrow("Invalid collection address")
  })

  it("rejects invalid chain ids", () => {
    expect(normalizeChainId(99801)).toBe(99801)
    expect(() => normalizeChainId(0)).toThrow("Invalid chain id")
    expect(() => normalizeChainId(-1)).toThrow("Invalid chain id")
    expect(() => normalizeChainId(1.5)).toThrow("Invalid chain id")
    expect(() => normalizeChainId(2147483648)).toThrow("Invalid chain id")
  })

  it("builds chain-scoped listing ids", () => {
    expect(buildListingId(99801, collection, "01")).toBe(`99801:${collection.toLowerCase()}-1`)
    expect(buildListingId(11155111, collection, "1")).toBe(`11155111:${collection.toLowerCase()}-1`)
  })
})
