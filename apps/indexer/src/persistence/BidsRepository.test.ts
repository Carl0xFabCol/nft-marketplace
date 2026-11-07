import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({
  env: { chainId: 99801 },
}))

const rpc = vi.fn().mockResolvedValue({ data: 1, error: null })

import { BidsRepository } from "./BidsRepository"

const collectionAddress = "0x880176caEd2C38F889e5E0AD6Ae55A871dd0f3B5"
const bidderWallet = "0x373cDd612dE9857DeA8cA360EFc302405dD82860"
const at = new Date("2026-01-01T00:00:00Z")
const position = { blockNumber: 16454481n, logIndex: 4, txHash: "0xABCDEF0000000000000000000000000000000000000000000000000000000001" }

function buildRepo(chainId?: number) {
  return new BidsRepository({ rpc } as never, chainId)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// IDX-6 / IDX-7: every bid write is one RPC call carrying chain_id, the
// lower-cased slot and the position of the event that caused it.
describe("BidsRepository (IDX-6 / IDX-7)", () => {
  const identity = {
    p_chain_id: 99801,
    p_collection_address: collectionAddress.toLowerCase(),
    p_bidder_wallet: bidderWallet.toLowerCase(),
    p_block_number: "16454481",
    p_log_index: 4,
    p_tx_hash: position.txHash.toLowerCase(),
    p_at: at.toISOString(),
  }

  it("placeCollectionBid", async () => {
    await buildRepo().placeCollectionBid({ collectionAddress, bidderWallet }, position, at, { price: "1234567890123456789", quantity: 3, expiresAt: null })
    expect(rpc).toHaveBeenCalledWith("indexer_apply_collection_bid_event", {
      p_kind: "placed",
      ...identity,
      p_price_wei: "1234567890123456789",
      p_quantity: 3,
      p_expires_at: null,
    })
  })

  it("cancelCollectionBid and fillCollectionBid", async () => {
    await buildRepo().cancelCollectionBid({ collectionAddress, bidderWallet }, position, at)
    await buildRepo().fillCollectionBid({ collectionAddress, bidderWallet }, position, at, 2)
    expect(rpc).toHaveBeenNthCalledWith(1, "indexer_apply_collection_bid_event", { p_kind: "cancelled", ...identity })
    expect(rpc).toHaveBeenNthCalledWith(2, "indexer_apply_collection_bid_event", { p_kind: "filled", ...identity, p_token_count: 2 })
  })

  it("placeTokenBid and closeTokenBid", async () => {
    const expiresAt = new Date("2026-02-01T00:00:00Z")
    await buildRepo().placeTokenBid({ collectionAddress, tokenId: "7", bidderWallet }, position, at, { price: "5", expiresAt })
    await buildRepo().closeTokenBid({ collectionAddress, tokenId: "7", bidderWallet }, position, at)
    expect(rpc).toHaveBeenNthCalledWith(1, "indexer_apply_token_bid_event", {
      p_kind: "placed",
      ...identity,
      p_token_id: "7",
      p_price_wei: "5",
      p_expires_at: expiresAt.toISOString(),
    })
    expect(rpc).toHaveBeenNthCalledWith(2, "indexer_apply_token_bid_event", { p_kind: "closed", ...identity, p_token_id: "7" })
  })

  it("uses an explicit chain id when given (one repository per chain)", async () => {
    await buildRepo(11155111).cancelCollectionBid({ collectionAddress, bidderWallet }, position, at)
    expect(rpc).toHaveBeenCalledWith("indexer_apply_collection_bid_event", expect.objectContaining({ p_chain_id: 11155111 }))
  })

  it("throws the RPC error so the cursor holds", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "bad" } })
    await expect(buildRepo().closeTokenBid({ collectionAddress, tokenId: "7", bidderWallet }, position, at)).rejects.toMatchObject({ code: "22023" })
  })
})
