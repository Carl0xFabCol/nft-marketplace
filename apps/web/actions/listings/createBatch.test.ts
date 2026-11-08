import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const rpc = vi.fn()
  const from = vi.fn()
  const requireWalletMatch = vi.fn()
  const revalidatePath = vi.fn()

  return {
    rpc,
    from,
    requireWalletMatch,
    revalidatePath,
  }
})

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }),
}))

vi.mock("@/lib/supabase/auth", () => ({
  requireWalletMatch: mocks.requireWalletMatch,
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

import { saveBatchListingToDB, type BatchListingData } from "./createBatch"

const HASH = `0x${"A".repeat(64)}`
const COLLECTION = "0x0000000000000000000000000000000000000002"
const SELLER = "0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294"
const OTHER = "0x0000000000000000000000000000000000000001"

function data(overrides: Partial<BatchListingData> = {}): BatchListingData {
  return {
    txHash: HASH as `0x${string}`,
    collections: [COLLECTION],
    tokenIds: ["1"],
    prices: ["100"],
    seller: SELLER,
    chainId: 99801,
    expiresAts: ["0"],
    ...overrides,
  }
}

describe("saveBatchListingToDB", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireWalletMatch.mockResolvedValue({})
    mocks.rpc.mockResolvedValue({ data: 1, error: null })
  })

  it("normalizes and delegates the batch to the atomic database RPC", async () => {
    await expect(saveBatchListingToDB(data())).resolves.toEqual({ success: true })

    expect(mocks.requireWalletMatch).toHaveBeenCalledWith(SELLER)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith("sec01_save_listing_batch", {
      p_seller: SELLER,
      p_tx_hash: HASH.toLowerCase(),
      p_chain_id: 99801,
      p_rows: [
        {
          collection_address: COLLECTION,
          token_id: "1",
          price: "100",
          expires_at: null,
        },
      ],
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/user/${SELLER}`)
  })

  it("canonicalizes token ids before sending them to the RPC", async () => {
    await saveBatchListingToDB(data({ tokenIds: ["0001"] }))

    const [, params] = mocks.rpc.mock.calls[0]
    expect(params.p_rows[0].token_id).toBe("1")
  })

  it("rejects duplicate listings after token canonicalization", async () => {
    await expect(
      saveBatchListingToDB(
        data({
          collections: [COLLECTION, COLLECTION],
          tokenIds: ["1", "01"],
          prices: ["100", "200"],
          expiresAts: ["0", "0"],
        }),
      ),
    ).rejects.toThrow("Duplicate listing in batch")

    expect(mocks.requireWalletMatch).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("converts positive expirations to ISO timestamps", async () => {
    await saveBatchListingToDB(data({ expiresAts: ["1"] }))

    const [, params] = mocks.rpc.mock.calls[0]
    expect(params.p_rows[0].expires_at).toBe("1970-01-01T00:00:01.000Z")
  })

  it("surfaces a transaction-hash ownership conflict from the RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "Forbidden: Transaction belongs to another wallet" },
    })

    await expect(saveBatchListingToDB(data())).rejects.toThrow(
      "Forbidden: Transaction belongs to another wallet",
    )

    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("surfaces a listing ownership conflict from the RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "Forbidden: Listing belongs to another wallet" },
    })

    await expect(saveBatchListingToDB(data())).rejects.toThrow(
      "Forbidden: Listing belongs to another wallet",
    )

    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("reports listings_nft_fk (23503) as not_indexed instead of failing", async () => {
    // Exact PostgREST error captured from the local stack (Phase 4).
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23503",
        details: 'Key (collection_address, token_id, chain_id)=(0x…c1, 1, 99801) is not present in table "nfts".',
        hint: null,
        message: 'insert or update on table "listings" violates foreign key constraint "listings_nft_fk"',
      },
    })

    await expect(saveBatchListingToDB(data())).resolves.toEqual({ success: false, reason: "not_indexed" })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("keeps other foreign-key violations generic", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23503", message: 'insert or update on table "listings" violates foreign key constraint "some_other_fk"' },
    })

    await expect(saveBatchListingToDB(data())).rejects.toThrow("Failed to save listings")
  })

  it("does not leak arbitrary database errors", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "internal database detail" },
    })

    await expect(saveBatchListingToDB(data())).rejects.toThrow("Failed to save listings")
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("rejects an unexpected saved row count", async () => {
    mocks.rpc.mockResolvedValue({ data: 0, error: null })

    await expect(saveBatchListingToDB(data())).rejects.toThrow("Failed to save listings")
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("delegates repeated calls without a read-before-write preflight", async () => {
    await Promise.all([saveBatchListingToDB(data()), saveBatchListingToDB(data())])

    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("propagates wallet authorization failures before calling the RPC", async () => {
    mocks.requireWalletMatch.mockRejectedValue(new Error("Forbidden: Wallet mismatch"))

    await expect(saveBatchListingToDB(data())).rejects.toThrow("Forbidden: Wallet mismatch")

    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects a missing or unsupported chain before auth or database access", async () => {
    await expect(saveBatchListingToDB(data({ chainId: 1 }))).rejects.toThrow("Unsupported chain")
    await expect(saveBatchListingToDB(data({ chainId: undefined as unknown as number }))).rejects.toThrow("Unsupported chain")

    expect(mocks.requireWalletMatch).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects malformed input before auth or database access", async () => {
    await expect(saveBatchListingToDB(data({ prices: ["0"] }))).rejects.toThrow("Invalid price")

    expect(mocks.requireWalletMatch).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects mismatched array lengths before auth or database access", async () => {
    await expect(
      saveBatchListingToDB(data({ tokenIds: ["1", "2"] })),
    ).rejects.toThrow("Invalid collection list")

    expect(mocks.requireWalletMatch).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects another wallet's seller address at the auth guard", async () => {
    mocks.requireWalletMatch.mockRejectedValue(new Error("Forbidden: Wallet mismatch"))

    await expect(saveBatchListingToDB(data({ seller: OTHER }))).rejects.toThrow(
      "Forbidden: Wallet mismatch",
    )

    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
