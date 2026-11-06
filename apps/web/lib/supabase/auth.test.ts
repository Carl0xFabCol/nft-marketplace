import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const getUser = vi.fn()
  const maybeSingle = vi.fn()
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const walletFrom = vi.fn(() => ({ select }))
  const profileFrom = vi.fn()
  return { getUser, maybeSingle, eq, select, walletFrom, profileFrom }
})

vi.mock("./server", () => ({
  getServerSupabase: async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.profileFrom,
  }),
}))

vi.mock("./admin", () => ({
  createSupabaseAdmin: () => ({ from: mocks.walletFrom }),
}))

import { getAuthenticatedWallet, requireWalletMatch } from "./auth"

const WALLET = "0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294"

describe("requireWalletMatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "2f1a6f2e-6a5d-4e3f-8f7b-6a4e2c1d9b10" } },
      error: null,
    })
    mocks.maybeSingle.mockResolvedValue({
      data: { wallet_address: WALLET },
      error: null,
    })
  })

  it("rejects callers without an authenticated user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })

    await expect(requireWalletMatch(WALLET)).rejects.toThrow("Unauthorized")
  })

  it("rejects callers when session resolution errors", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("session failure") })

    await expect(requireWalletMatch(WALLET)).rejects.toThrow("Unauthorized")
  })

  it("allows a wallet that matches the server-side user_wallets mapping", async () => {
    const client = await requireWalletMatch(WALLET.toUpperCase())

    expect(client).toBeDefined()
    expect(mocks.walletFrom).toHaveBeenCalledWith("user_wallets")
    expect(mocks.select).toHaveBeenCalledWith("wallet_address")
    expect(mocks.eq).toHaveBeenCalledWith("supabase_user_id", "2f1a6f2e-6a5d-4e3f-8f7b-6a4e2c1d9b10")
    expect(mocks.profileFrom).not.toHaveBeenCalled()
  })

  it("matches case variants on both sides of the trusted mapping", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { wallet_address: WALLET.toUpperCase() },
      error: null,
    })

    await expect(requireWalletMatch(WALLET.toLowerCase())).resolves.toBeDefined()
  })

  it("rejects a wallet that does not match the trusted mapping", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { wallet_address: "0x0000000000000000000000000000000000000001" },
      error: null,
    })

    await expect(requireWalletMatch(WALLET)).rejects.toThrow("Forbidden: Wallet mismatch")
  })

  it("does not fall back to profiles.wallet when no user_wallets mapping exists", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(requireWalletMatch(WALLET)).rejects.toThrow("Forbidden: Wallet mismatch")
    expect(mocks.profileFrom).not.toHaveBeenCalled()
  })

  it("fails closed when the mapping lookup errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.maybeSingle.mockResolvedValue({ data: null, error: new Error("db unavailable") })

    await expect(requireWalletMatch(WALLET)).rejects.toThrow("Forbidden: Wallet mismatch")
    consoleError.mockRestore()
  })
})

describe("getAuthenticatedWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "2f1a6f2e-6a5d-4e3f-8f7b-6a4e2c1d9b10" } },
      error: null,
    })
    mocks.maybeSingle.mockResolvedValue({
      data: { wallet_address: WALLET.toUpperCase() },
      error: null,
    })
  })

  it("returns the canonical authenticated wallet from the trusted mapping", async () => {
    await expect(getAuthenticatedWallet()).resolves.toBe(WALLET)
  })

  it("fails closed without a trusted mapping", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(getAuthenticatedWallet()).rejects.toThrow("Forbidden: Wallet mismatch")
  })
})
