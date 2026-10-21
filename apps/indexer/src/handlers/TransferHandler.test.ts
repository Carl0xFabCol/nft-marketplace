import { describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({
  env: { chainId: 99801 },
}))

import type { Address } from "viem"
import { TransferHandler } from "./TransferHandler"
import type { ParsedEvent } from "../types/indexer.types"

const collection = "0xd71331443968a9d958a5c5089cf74051f7b9d7e2" as Address
const owner = "0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294" as Address
const zero = "0x0000000000000000000000000000000000000000" as Address
const blockTimestamp = 1790000000

const metadata = {
  tokenUri: "ipfs://bafy-token-0",
  imageUrl: "https://ipfs.io/ipfs/bafy-image-0",
  metadata: { name: "Hypurr #0", image: "ipfs://bafy-image-0" },
}

function makeEvent(from: Address, to: Address, tokenId = 0n): ParsedEvent<{ from: Address; to: Address; tokenId: bigint }> {
  return {
    contractName: "nft",
    contractAddress: collection,
    eventName: "Transfer",
    args: { from, to, tokenId },
    blockNumber: 10298977n,
    blockTimestamp,
    transactionHash: "0x3f636d3a78efb7b37e31c4d29c66fce1552c329ac0ae7dd075dce894cfd3c96f",
    logIndex: 0,
    raw: {} as never,
  }
}

function buildHandler() {
  const activityRepo = { insert: vi.fn().mockResolvedValue(undefined) }
  const nftRepo = {
    updateOwner: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
  }
  const metadataFetcher = { getNFTData: vi.fn().mockResolvedValue(metadata) }

  const handler = new TransferHandler(activityRepo as never, nftRepo as never, metadataFetcher as never)
  return { handler, activityRepo, nftRepo, metadataFetcher }
}

describe("TransferHandler", () => {
  it("upserts the NFT with metadata on mint", async () => {
    const { handler, nftRepo, metadataFetcher, activityRepo } = buildHandler()

    await handler.handle(makeEvent(zero, owner, 0n))

    expect(metadataFetcher.getNFTData).toHaveBeenCalledWith(collection, "0")
    expect(nftRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionAddress: collection,
        tokenId: "0",
        ownerWallet: owner,
        chainId: 99801,
        tokenUri: metadata.tokenUri,
        imageUrl: metadata.imageUrl,
        metadata: metadata.metadata,
        mintedAt: new Date(blockTimestamp * 1000),
      }),
    )
    expect(nftRepo.updateOwner).not.toHaveBeenCalled()
    expect(activityRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "TRANSFER",
        from: undefined,
        to: owner.toLowerCase(),
        sourceContract: "nft_transfer",
      }),
    )
  })

  it("falls back to updateOwner when the mint has no tokenURI", async () => {
    const { handler, nftRepo, metadataFetcher } = buildHandler()
    metadataFetcher.getNFTData.mockResolvedValueOnce({ tokenUri: null, imageUrl: null, metadata: null })

    await handler.handle(makeEvent(zero, owner, 1n))

    expect(nftRepo.upsert).not.toHaveBeenCalled()
    expect(nftRepo.updateOwner).toHaveBeenCalledWith(collection, "1", owner, new Date(blockTimestamp * 1000))
  })

  it("updates the owner on a normal transfer", async () => {
    const { handler, nftRepo, metadataFetcher } = buildHandler()

    await handler.handle(makeEvent(owner, collection, 2n))

    expect(nftRepo.updateOwner).toHaveBeenCalledWith(collection, "2", collection, new Date(blockTimestamp * 1000))
    expect(nftRepo.upsert).not.toHaveBeenCalled()
    expect(metadataFetcher.getNFTData).not.toHaveBeenCalled()
  })

  it("updates the owner to zero on burn", async () => {
    const { handler, nftRepo, activityRepo } = buildHandler()

    await handler.handle(makeEvent(owner, zero, 3n))

    expect(nftRepo.updateOwner).toHaveBeenCalledWith(collection, "3", zero, new Date(blockTimestamp * 1000))
    expect(activityRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ event: "TRANSFER", to: undefined }))
  })
})
