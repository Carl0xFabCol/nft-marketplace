import path from "node:path"
import { privateKeyToAccount } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { ANVIL_ACCOUNTS, assertRehearsalLaunch, isLoopbackUrl, redact, REHEARSAL_CHAIN_ID, urlsIn } from "../guards"

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..")
const okEnv = {
  REHEARSAL: "1",
  CHAIN_ID: "31337",
  DOTENV_CONFIG_PATH: "/scratch/empty-dotenv",
  FAST_RPC_URL: "http://127.0.0.1:8545",
  SUPABASE_URL: "http://127.0.0.1:54321",
}
const check = (env: Record<string, string | undefined>, argv: string[] = []) =>
  assertRehearsalLaunch({ env, argv, repoRoot, cwd: repoRoot })

describe("Anvil test accounts", () => {
  it("every hard-coded key derives its hard-coded address (published Anvil defaults only)", () => {
    expect(ANVIL_ACCOUNTS.length).toBeGreaterThanOrEqual(7)
    for (const a of ANVIL_ACCOUNTS) expect(privateKeyToAccount(a.privateKey).address).toBe(a.address)
    expect(ANVIL_ACCOUNTS[0].address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")
  })
})

describe("isLoopbackUrl", () => {
  it.each(["http://127.0.0.1:8545", "http://localhost:54321/rest/v1", "http://[::1]:8545", "ws://127.0.0.1:8545", "postgresql://postgres:x@127.0.0.1:54322/postgres"])(
    "accepts %s",
    (u) => expect(isLoopbackUrl(u)).toBe(true),
  )
  it.each([
    "https://testnet-rpc.elysium.kinetiq.xyz",
    "https://abc.supabase.co",
    "http://127.0.0.1.evil.example:8545",
    "http://10.0.0.5:8545",
    "http://0.0.0.0:8545",
    "file:///etc/passwd",
    "not a url",
    "",
  ])("rejects %s", (u) => expect(isLoopbackUrl(u)).toBe(false))
})

describe("assertRehearsalLaunch", () => {
  it("accepts a fully local configuration", () => {
    expect(() => check(okEnv, ["--rpc", "anvil=http://127.0.0.1:8545", "--out", "/scratch/addresses.generated.ts"])).not.toThrow()
    expect(REHEARSAL_CHAIN_ID).toBe(31337)
  })
  it("requires REHEARSAL=1", () => expect(() => check({ ...okEnv, REHEARSAL: undefined })).toThrow(/REHEARSAL=1/))
  it("requires CHAIN_ID=31337 (never a production chain)", () => {
    expect(() => check({ ...okEnv, CHAIN_ID: "99801" })).toThrow(/CHAIN_ID must be 31337/)
    expect(() => check({ ...okEnv, CHAIN_ID: undefined })).toThrow(/CHAIN_ID/)
  })
  it("requires DOTENV_CONFIG_PATH, and refuses a .env file", () => {
    expect(() => check({ ...okEnv, DOTENV_CONFIG_PATH: undefined })).toThrow(/DOTENV_CONFIG_PATH/)
    expect(() => check({ ...okEnv, DOTENV_CONFIG_PATH: "/repo/apps/indexer/.env" })).toThrow(/must not be a .env/)
  })
  it("refuses a remote RPC or Supabase URL", () => {
    expect(() => check({ ...okEnv, FAST_RPC_URL: "https://testnet-rpc.elysium.kinetiq.xyz" })).toThrow(/FAST_RPC_URL must be a loopback/)
    expect(() => check({ ...okEnv, SUPABASE_URL: "https://abc.supabase.co" })).toThrow(/SUPABASE_URL must be a loopback/)
    expect(() => check({ ...okEnv, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })
  it("refuses any remote-capable fallback endpoint, even a local one", () => {
    expect(() => check({ ...okEnv, ARCHIVE_RPC_URL: "http://127.0.0.1:8545" })).toThrow(/ARCHIVE_RPC_URL must be empty/)
    expect(() => check({ ...okEnv, FALLBACK_RPC_URL: "https://x.example" })).toThrow(/FALLBACK_RPC_URL/)
    expect(() => check({ ...okEnv, IPFS_GATEWAY: "https://gateway.pinata.cloud/ipfs" })).toThrow(/IPFS_GATEWAY/)
  })
  it("refuses a remote URL hidden in argv (e.g. --rpc anvil=https://…)", () => {
    expect(() => check(okEnv, ["--rpc", "anvil=https://testnet-rpc.elysium.kinetiq.xyz"])).toThrow(/argv URL/)
  })
  it("refuses --out into packages/contracts/src (the committed address map)", () => {
    expect(() => check(okEnv, ["--out", path.join(repoRoot, "packages", "contracts", "src", "addresses.generated.ts")])).toThrow(/inside packages\/contracts\/src/)
    expect(() => check(okEnv, ["--out", "packages/contracts/src/x.ts"])).toThrow(/inside packages\/contracts\/src/)
    expect(() => check(okEnv, ["--out"])).toThrow(/--out requires a value/)
  })
})

describe("helpers", () => {
  it("urlsIn finds URLs inside name=url pairs", () => {
    expect(urlsIn("anvil=http://127.0.0.1:8545")).toEqual(["http://127.0.0.1:8545"])
    expect(urlsIn("--force")).toEqual([])
  })
  it("redact hides credentials", () => {
    expect(redact("postgresql://postgres:secret@127.0.0.1:54322/postgres")).not.toContain("secret")
    expect(redact("https://rpc.example/?token=abc")).not.toContain("abc")
  })
})
