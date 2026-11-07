import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({
  env: { chainId: 99801 },
}))

const insert = vi.fn().mockResolvedValue({ data: null, error: null })
const from = vi.fn(() => ({ insert }))

import { BidsRepository } from "./BidsRepository"

const collectionAddress = "0x880176caEd2C38F889e5E0AD6Ae55A871dd0f3B5"
const bidderWallet = "0x373cDd612dE9857DeA8cA360EFc302405dD82860"
const timestamp = new Date("2026-01-01T00:00:00Z")

function buildRepo() {
  return new BidsRepository({ from } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// M-1: token_bids/collection_bids.chain_id is NOT NULL without a default, so
// every insert must carry the indexer's chain.
describe("BidsRepository inserts carry chain_id (M-1)", () => {
  it("insertCollectionBid writes chain_id", async () => {
    await buildRepo().insertCollectionBid({
      collectionAddress,
      bidderWallet,
      price: 1,
      quantity: 2,
      expiresAt: null,
      isActive: true,
      createdAt: timestamp,
    })

    expect(from).toHaveBeenCalledWith("collection_bids")
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        chain_id: 99801,
        collection_address: collectionAddress.toLowerCase(),
        bidder_wallet: bidderWallet.toLowerCase(),
      }),
    )
  })

  it("insertTokenBid writes chain_id", async () => {
    await buildRepo().insertTokenBid({
      collectionAddress,
      tokenId: "7",
      bidderWallet,
      price: 1,
      expiresAt: null,
      isActive: true,
      createdAt: timestamp,
    })

    expect(from).toHaveBeenCalledWith("token_bids")
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        chain_id: 99801,
        collection_address: collectionAddress.toLowerCase(),
        token_id: "7",
        bidder_wallet: bidderWallet.toLowerCase(),
      }),
    )
  })
})
