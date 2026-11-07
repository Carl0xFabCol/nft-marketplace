// ADDR-3: CHAIN_ID is required and must be a supported chain; no silent
// Sepolia default. dotenv/config is mocked, so no .env file is ever read.
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("dotenv/config", () => ({}))

import { getViemChain } from "../providers/chains"

async function loadEnv(vars: Record<string, string | undefined>) {
  vi.resetModules()
  vi.stubEnv("FAST_RPC_URL", "http://127.0.0.1:1")
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:1")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "env-test-stub")
  vi.stubEnv("CONFIRMATIONS", undefined)
  vi.stubEnv("BATCH_SIZE", undefined)
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v)
  return (await import("./env")).env
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("env CHAIN_ID (ADDR-3)", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["non-numeric", "elysium"],
    ["unsupported", "1"],
    ["fractional", "99801.5"],
  ])("throws when CHAIN_ID is %s", async (_label, value) => {
    await expect(loadEnv({ CHAIN_ID: value })).rejects.toThrow(/CHAIN_ID/)
  })

  it.each([99801, 11155111])("accepts supported chain %i", async (chainId) => {
    expect((await loadEnv({ CHAIN_ID: String(chainId) })).chainId).toBe(chainId)
  })
})

describe("env CONFIRMATIONS (IDX-3)", () => {
  it("defaults to 12", async () => {
    expect((await loadEnv({ CHAIN_ID: "99801" })).confirmations).toBe(12)
  })

  it("accepts 0", async () => {
    expect((await loadEnv({ CHAIN_ID: "99801", CONFIRMATIONS: "0" })).confirmations).toBe(0)
  })

  it.each(["-1", "1.5", "abc"])("rejects %s", async (value) => {
    await expect(loadEnv({ CHAIN_ID: "99801", CONFIRMATIONS: value })).rejects.toThrow(/CONFIRMATIONS/)
  })
})

describe("env BATCH_SIZE (IDX-8)", () => {
  it.each(["0", "-5", "abc"])("rejects %s (a 0-block chunk would never advance)", async (value) => {
    await expect(loadEnv({ CHAIN_ID: "99801", BATCH_SIZE: value })).rejects.toThrow(/BATCH_SIZE/)
  })
})

describe("getViemChain (ADDR-3)", () => {
  it("throws for an unknown chain instead of falling back to Sepolia", () => {
    expect(() => getViemChain(1)).toThrow(/Unsupported chain id 1/)
    expect(getViemChain(99801).id).toBe(99801)
  })
})
