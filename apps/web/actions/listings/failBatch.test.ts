import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const update = vi.fn()
  const updateEqHash = vi.fn()
  const updateEqChain = vi.fn()
  const updateEqSeller = vi.fn()
  update.mockReturnValue({ eq: updateEqHash })
  updateEqHash.mockReturnValue({ eq: updateEqChain })
  updateEqChain.mockReturnValue({ eq: updateEqSeller })
  updateEqSeller.mockResolvedValue({ error: null })

  const selectEqChain = vi.fn()
  const selectEqHash = vi.fn(() => ({ eq: selectEqChain }))
  const select = vi.fn(() => ({ eq: selectEqHash }))
  const from = vi.fn(() => ({ select, update }))
  const getAuthenticatedWallet = vi.fn()
  const revalidatePath = vi.fn()

  return {
    update,
    updateEqHash,
    updateEqChain,
    updateEqSeller,
    selectEqChain,
    selectEqHash,
    from,
    getAuthenticatedWallet,
    revalidatePath,
  }
})

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdmin: () => ({ from: mocks.from }),
}))

vi.mock("@/lib/supabase/auth", () => ({
  getAuthenticatedWallet: mocks.getAuthenticatedWallet,
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

import { failListingsByTxHash } from "./failBatch"

const HASH = `0x${"a".repeat(64)}`
const CHAIN_ID = 99801
const CALLER = "0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294"
const OTHER = "0x0000000000000000000000000000000000000001"

describe("failListingsByTxHash", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAuthenticatedWallet.mockResolvedValue(CALLER)
    mocks.selectEqChain.mockResolvedValue({ data: [], error: null })
  })

  it("scopes the failure update to the authenticated wallet's chain and rows", async () => {
    mocks.selectEqChain.mockResolvedValue({
      data: [{ seller_wallet: CALLER }, { seller_wallet: OTHER }],
      error: null,
    })

    await failListingsByTxHash(HASH, CHAIN_ID)

    expect(mocks.selectEqHash).toHaveBeenCalledWith("tx_hash", HASH)
    expect(mocks.selectEqChain).toHaveBeenCalledWith("chain_id", CHAIN_ID)
    expect(mocks.update).toHaveBeenCalledWith({ is_active: false, status: "failed" })
    expect(mocks.updateEqHash).toHaveBeenCalledWith("tx_hash", HASH)
    expect(mocks.updateEqChain).toHaveBeenCalledWith("chain_id", CHAIN_ID)
    expect(mocks.updateEqSeller).toHaveBeenCalledWith("seller_wallet", CALLER)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/user/${CALLER}`)
  })

  it("scopes cleanup to the requested chain even when the hash exists elsewhere", async () => {
    const SEPOLIA = 11155111
    mocks.selectEqChain.mockResolvedValue({
      data: [{ seller_wallet: CALLER }],
      error: null,
    })

    await failListingsByTxHash(HASH, SEPOLIA)

    expect(mocks.selectEqHash).toHaveBeenCalledWith("tx_hash", HASH)
    expect(mocks.selectEqChain).toHaveBeenCalledWith("chain_id", SEPOLIA)
    expect(mocks.updateEqChain).toHaveBeenCalledWith("chain_id", SEPOLIA)
  })

  it("does not mutate rows that belong only to another wallet", async () => {
    mocks.selectEqChain.mockResolvedValue({
      data: [{ seller_wallet: OTHER }],
      error: null,
    })

    await expect(failListingsByTxHash(HASH, CHAIN_ID)).resolves.toEqual({ success: true })

    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("rejects malformed hashes before auth or database access", async () => {
    await expect(failListingsByTxHash("not-a-hash", CHAIN_ID)).rejects.toThrow("Invalid transaction hash")

    expect(mocks.getAuthenticatedWallet).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("rejects unsupported chains before auth or database access", async () => {
    await expect(failListingsByTxHash(HASH, 1)).rejects.toThrow("Unsupported chain")

    expect(mocks.getAuthenticatedWallet).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
