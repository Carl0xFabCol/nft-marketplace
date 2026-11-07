import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({
  env: { chainId: 11155111 },
}))

type QueryBuilder = {
  update: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  error: null
}

const makeQueryBuilder = (): QueryBuilder => {
  const qb = {
    update: vi.fn(),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    eq: vi.fn(),
    error: null,
  } as QueryBuilder
  qb.update.mockReturnValue(qb)
  qb.eq.mockReturnValue(qb)
  return qb
}

const from = vi.fn(() => makeQueryBuilder())

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from })),
}))

import { ListingsRepository } from "./ListingsRepository"
import { env } from "../config/env"

const collectionAddress = "0x880176caEd2C38F889e5E0AD6Ae55A871dd0f3B5"
const tokenId = "01"
const sellerWallet = "0x373cDd612dE9857DeA8cA360EFc302405dD82860"
const timestamp = new Date("2026-01-01T00:00:00Z")

function buildRepo() {
  return new ListingsRepository({ from } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("ListingsRepository.upsert", () => {
  it("uses a chain-scoped canonical identity and conflict target", async () => {
    const qb = makeQueryBuilder()
    from.mockReturnValue(qb)

    await buildRepo().upsert({
      collectionAddress,
      tokenId,
      sellerWallet,
      price: "1",
      expiresAt: null,
      isActive: true,
      txHash: `0x${"A".repeat(64)}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "confirmed",
      source: "indexer",
    })

    expect(qb.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        listing_id: `11155111:${collectionAddress.toLowerCase()}-1`,
        chain_id: env.chainId,
        collection_address: collectionAddress.toLowerCase(),
        token_id: "1",
        seller_wallet: sellerWallet.toLowerCase(),
        buyer_wallet: null,
        tx_hash: `0x${"a".repeat(64)}`,
      }),
      { onConflict: "chain_id,collection_address,token_id", ignoreDuplicates: false },
    )
  })
})

describe("ListingsRepository.updatePrice", () => {
  it("scopes the update by chain, collection and token", async () => {
    const qb = makeQueryBuilder()
    from.mockReturnValue(qb)

    await buildRepo().updatePrice(collectionAddress, tokenId, "2", timestamp)

    expect(qb.update).toHaveBeenCalledWith({ price: "2", updated_at: timestamp })
    expect(qb.eq).toHaveBeenCalledWith("chain_id", env.chainId)
    expect(qb.eq).toHaveBeenCalledWith("collection_address", collectionAddress.toLowerCase())
    expect(qb.eq).toHaveBeenCalledWith("token_id", "1")
    expect(qb.eq).toHaveBeenCalledWith("is_active", true)
  })
})

describe("ListingsRepository.deactivate", () => {
  it("scopes the deactivation by chain, collection and token", async () => {
    const qb = makeQueryBuilder()
    from.mockReturnValue(qb)

    await buildRepo().deactivate(collectionAddress, tokenId, timestamp, sellerWallet)

    expect(qb.update).toHaveBeenCalledWith({
      is_active: false,
      updated_at: timestamp,
      buyer_wallet: sellerWallet.toLowerCase(),
    })
    expect(qb.eq).toHaveBeenCalledWith("chain_id", env.chainId)
    expect(qb.eq).toHaveBeenCalledWith("collection_address", collectionAddress.toLowerCase())
    expect(qb.eq).toHaveBeenCalledWith("token_id", "1")
  })
})
