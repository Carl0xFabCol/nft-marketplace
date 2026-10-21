import { describe, expect, it, vi, beforeEach } from "vitest"

// ════════════════════════════════════════════════════════════════════════════════
// MOCKS (hoisted by vitest so they run before any imports resolve)
// ════════════════════════════════════════════════════════════════════════════════

// env.ts calls loadEnv() at import time, which requires FAST_RPC_URL /
// SUPABASE_URL. Provide a fake env so the repository can be unit-tested.
vi.mock("../config/env", () => ({
  env: { chainId: 11155111 },
}))

type QueryBuilder = {
  update: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
}

const makeQueryBuilder = (): QueryBuilder => ({
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  eq: vi.fn().mockReturnThis(),
  select: vi.fn(),
})

const from = vi.fn(() => makeQueryBuilder())

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from })),
}))

// ════════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════════

import { NFTRepository } from "./NFTRepository"
import { env } from "../config/env"

const collectionAddress = "0x880176caEd2C38F889e5E0AD6Ae55A871dd0f3B5"
const tokenId = "1"
const ownerWallet = "0x373cDd612dE9857DeA8cA360EFc302405dD82860"
const lastSynced = new Date("2026-01-01T00:00:00Z")

function buildRepo() {
  return new NFTRepository({ from } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("NFTRepository.upsert", () => {
  it("writes minted_at and metadata when provided", async () => {
    const qb = makeQueryBuilder()
    from.mockReturnValue(qb)

    const mintedAt = new Date("2026-10-16T23:25:29Z")
    const repo = buildRepo()

    await repo.upsert({
      collectionAddress,
      tokenId,
      ownerWallet,
      lastSynced: mintedAt,
      chainId: env.chainId,
      tokenUri: "ipfs://bafy-token",
      imageUrl: "https://ipfs.io/ipfs/bafy-image",
      metadata: { name: "Hypurr #0" },
      mintedAt,
    })

    expect(qb.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_address: collectionAddress.toLowerCase(),
        token_id: tokenId,
        owner_wallet: ownerWallet.toLowerCase(),
        chain_id: env.chainId,
        token_uri: "ipfs://bafy-token",
        image_url: "https://ipfs.io/ipfs/bafy-image",
        metadata: { name: "Hypurr #0" },
        minted_at: mintedAt,
      }),
      { onConflict: "collection_address,token_id,chain_id" },
    )
  })

  it("omits minted_at when it is not provided", async () => {
    const qb = makeQueryBuilder()
    from.mockReturnValue(qb)

    const repo = buildRepo()
    await repo.upsert({
      collectionAddress,
      tokenId,
      ownerWallet,
      lastSynced,
      chainId: env.chainId,
      tokenUri: null,
      imageUrl: null,
      metadata: null,
    })

    const payload = qb.upsert.mock.calls[0][0]
    expect(payload).not.toHaveProperty("minted_at")
  })
})

describe("NFTRepository.updateOwner", () => {
  it("updates the owner when the NFT already exists", async () => {
    const qb = makeQueryBuilder()
    from.mockReturnValue(qb)
    qb.select.mockResolvedValueOnce({ data: [{ id: "1" }], error: null })

    const repo = buildRepo()
    const inserted = await repo.updateOwner(collectionAddress, tokenId, ownerWallet, lastSynced)

    expect(inserted).toBe(false)
    expect(qb.update).toHaveBeenCalled()
    expect(qb.eq).toHaveBeenCalledWith("chain_id", env.chainId)
    expect(qb.insert).not.toHaveBeenCalled()
  })

  it("inserts the NFT when it does not yet exist (transfer fallback)", async () => {
    const qb = makeQueryBuilder()
    from.mockReturnValue(qb)
    // update().select() returns no rows → NFT doesn't exist
    qb.select.mockResolvedValueOnce({ data: [], error: null })
    qb.insert.mockResolvedValueOnce({ data: [{ id: "2" }], error: null })

    const repo = buildRepo()
    const inserted = await repo.updateOwner(collectionAddress, tokenId, ownerWallet, lastSynced)

    expect(inserted).toBe(true)
    expect(qb.update).toHaveBeenCalled()
    expect(qb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_address: collectionAddress.toLowerCase(),
        token_id: tokenId,
        owner_wallet: ownerWallet.toLowerCase(),
        chain_id: env.chainId,
      }),
    )
  })

  it("applies optional metadata only on insert", async () => {
    const qb = makeQueryBuilder()
    from.mockReturnValue(qb)
    qb.select.mockResolvedValueOnce({ data: [], error: null })
    qb.insert.mockResolvedValueOnce({ data: [{ id: "2" }], error: null })

    const repo = buildRepo()
    const inserted = await repo.updateOwner(
      collectionAddress,
      tokenId,
      ownerWallet,
      lastSynced,
      {
        tokenUri: "ipfs://bafy-token",
        imageUrl: "https://gateway.pinata.cloud/ipfs/bafy-image",
        metadata: { name: "Hypurr #0" },
      },
    )

    expect(inserted).toBe(true)
    expect(qb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_address: collectionAddress.toLowerCase(),
        token_id: tokenId,
        owner_wallet: ownerWallet.toLowerCase(),
        chain_id: env.chainId,
        token_uri: "ipfs://bafy-token",
        image_url: "https://gateway.pinata.cloud/ipfs/bafy-image",
        metadata: { name: "Hypurr #0" },
      }),
    )
  })

  it("does not apply optional metadata when updating an existing row", async () => {
    const qb = makeQueryBuilder()
    from.mockReturnValue(qb)
    qb.select.mockResolvedValueOnce({ data: [{ id: "1" }], error: null })

    const repo = buildRepo()
    await repo.updateOwner(
      collectionAddress,
      tokenId,
      ownerWallet,
      lastSynced,
      {
        tokenUri: "ipfs://bafy-token",
        imageUrl: "https://gateway.pinata.cloud/ipfs/bafy-image",
        metadata: { name: "Hypurr #0" },
      },
    )

    expect(qb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_wallet: ownerWallet.toLowerCase(),
        last_synced: lastSynced,
      }),
    )
    expect(qb.insert).not.toHaveBeenCalled()
  })

  it("throws when the update fails", async () => {
    const qb = makeQueryBuilder()
    from.mockReturnValue(qb)
    qb.select.mockResolvedValueOnce({ data: null, error: new Error("db down") })

    const repo = buildRepo()
    await expect(repo.updateOwner(collectionAddress, tokenId, ownerWallet, lastSynced)).rejects.toThrow("db down")
    expect(qb.insert).not.toHaveBeenCalled()
  })

  it("throws when the insert fallback fails", async () => {
    const qb = makeQueryBuilder()
    from.mockReturnValue(qb)
    qb.select.mockResolvedValueOnce({ data: [], error: null })
    qb.insert.mockResolvedValueOnce({ data: null, error: new Error("insert down") })

    const repo = buildRepo()
    await expect(repo.updateOwner(collectionAddress, tokenId, ownerWallet, lastSynced)).rejects.toThrow("insert down")
  })
})
