import { afterEach, describe, expect, it, vi } from "vitest"

import type { Address } from "viem"
import { MetadataFetcher } from "./MetadataFetcher"

const collection = "0xd71331443968a9d958a5c5089cf74051f7b9d7e2" as Address

function fetcherWith(tokenUri: string) {
  const provider = { readContract: vi.fn().mockResolvedValue(tokenUri) }
  return new MetadataFetcher(provider as never)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("MetadataFetcher", () => {
  it("falls back to the next IPFS gateway when one is rate limited", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: "Hypurr #1", image: "ipfs://bafyimage" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const data = await fetcherWith("ipfs://bafydir/1").getNFTData(collection, "1")

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe("https://gateway.pinata.cloud/ipfs/bafydir/1")
    expect(data.metadata).toEqual({ name: "Hypurr #1", image: "ipfs://bafyimage" })
    expect(data.imageUrl).toBe("https://gateway.pinata.cloud/ipfs/bafyimage")
  })

  it("does not use a gateway for non-IPFS URIs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: "Centralized" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const data = await fetcherWith("https://example.com/1.json").getNFTData(collection, "1")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/1.json")
    expect(data.imageUrl).toBeNull()
  })
})
