// Test #6 (INTEGRATION_AUDIT §10): reject-partial-record suite.
// One or more negative cases per §3.3 rule. Every rejection must exit
// non-zero and write nothing. Fixture records + mocked ChainReader only:
// no live RPC is ever contacted.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getAddress, type Address, type Hex } from "viem"
import { parseRpcEndpoints, renderAddresses, runGenerateAddresses, type ChainReader, type RecordFile, type RunOptions } from "../lib/addresses"

const CORE = getAddress("0x1000000000000000000000000000000000000001")
const BIDS = getAddress("0x2000000000000000000000000000000000000002")
const ROUTER = getAddress("0x3000000000000000000000000000000000000003")
const LAUNCHPAD = getAddress("0x4000000000000000000000000000000000000004")
const DEPLOYER = getAddress("0x5000000000000000000000000000000000000005")
const ZERO = "0x0000000000000000000000000000000000000000"

function verifiedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    core: CORE,
    bids: BIDS,
    marketplace: ROUTER,
    launchpad: LAUNCHPAD,
    feeReceiver: DEPLOYER,
    deployer: DEPLOYER,
    marketplaceFee: 100,
    launchFee: 0,
    chainId: 99801,
    updatedAt: 1790000000,
    configured: true,
    stage: "verified",
    network: "elysium",
    ...overrides,
  }
}

interface ChainState {
  chainId: number
  code: Record<string, Hex>
  getters: Record<string, Address>
  fingerprint: boolean
}

function healthyChain(): ChainState {
  return {
    chainId: 99801,
    code: { [CORE]: "0x6080", [BIDS]: "0x6080", [ROUTER]: "0x6080", [LAUNCHPAD]: "0x6080" },
    getters: {
      [`${BIDS}.core`]: CORE,
      [`${BIDS}.marketplace`]: ROUTER,
      [`${ROUTER}.core`]: CORE,
      [`${ROUTER}.bids`]: BIDS,
      [`${CORE}.router`]: ROUTER,
      [`${CORE}.bidsContract`]: BIDS,
      [`${LAUNCHPAD}.core`]: CORE,
    },
    fingerprint: true,
  }
}

/** Mock RPC that also records every call, to prove no live network is used. */
function mockReader(state: ChainState, calls: string[] = []): ChainReader {
  return {
    async getChainId() {
      calls.push("eth_chainId")
      return state.chainId
    },
    async getCode(address) {
      calls.push(`eth_getCode ${address}`)
      return state.code[address] ?? "0x"
    },
    async readAddress(contract, fn) {
      calls.push(`${contract}.${fn}`)
      const v = state.getters[`${contract}.${fn}`]
      if (!v) throw new Error("execution reverted")
      return v
    },
    async readUint(contract, fn) {
      calls.push(`${contract}.${fn}`)
      if (!state.fingerprint || contract !== CORE) throw new Error("execution reverted: Invalid call")
      return 150_000n
    },
  }
}

let dir: string
let outPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gen-addr-"))
  outPath = path.join(dir, "addresses.generated.ts")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(records: RecordFile[], state: ChainState = healthyChain(), extra: Partial<RunOptions> = {}) {
  return runGenerateAddresses({
    records,
    readerFor: () => mockReader(state),
    outPath,
    check: false,
    ...extra,
  })
}

const elysium = (overrides: Record<string, unknown> = {}): RecordFile => ({
  fileName: "elysium.json",
  data: verifiedRecord(overrides),
})

/** Every negative case: non-zero exit, the expected rule cited, and no write. */
async function expectRejected(promise: ReturnType<typeof run>, rule: number, pattern?: RegExp) {
  const result = await promise
  expect(result.exitCode).not.toBe(0)
  expect(result.written).toBe(false)
  expect(existsSync(outPath)).toBe(false)
  expect(result.errors.some((e) => e.startsWith(`[rule ${rule}]`))).toBe(true)
  if (pattern) expect(result.errors.join("\n")).toMatch(pattern)
  return result
}

describe("positive path", () => {
  it("writes the generated file for a fully verified, cohesive deployment", async () => {
    const result = await run([elysium()])
    expect(result).toEqual({ exitCode: 0, errors: [], written: true })
    const content = readFileSync(outPath, "utf8")
    expect(content).toContain(`MARKETPLACE_CORE: "${CORE}"`)
    expect(content).toContain(`LAUNCHPAD: "${LAUNCHPAD}"`)
    expect(content).toContain("DEPLOYMENT_METADATA")
    expect(content).toContain("verifiedAt: 1790000000")
  })

  it("treats a zero launchpad as absent", async () => {
    const result = await run([elysium({ launchpad: ZERO })])
    expect(result.exitCode).toBe(0)
    expect(readFileSync(outPath, "utf8")).not.toContain("LAUNCHPAD:")
  })

  it("is deterministic regardless of record order", () => {
    const a = { network: "elysium", chainId: 99801, core: CORE, bids: BIDS, marketplace: ROUTER }
    const b = { network: "sepolia", chainId: 11155111, core: CORE, bids: BIDS, marketplace: ROUTER }
    expect(renderAddresses([a, b])).toBe(renderAddresses([b, a]))
  })
})

describe("rule 1: stage=verified and configured=true", () => {
  it("rejects stage=partial", () => expectRejected(run([elysium({ stage: "partial", configured: false })]), 1, /stage/))
  it("rejects configured=false even with stage=verified", () =>
    expectRejected(run([elysium({ configured: false })]), 1, /configured/))
  it("rejects a record with no stage at all", () => expectRejected(run([elysium({ stage: undefined })]), 1))
})

describe("rule 2: chainId valid and matching the filename network", () => {
  it("rejects a wrong chainId", () => expectRejected(run([elysium({ chainId: 11155111 })]), 2, /does not match network/))
  it("rejects a missing chainId", () => expectRejected(run([elysium({ chainId: undefined })]), 2))
  it("rejects a non-integer chainId", () => expectRejected(run([elysium({ chainId: "99801" })]), 2))
  it("rejects a non-positive chainId", () => expectRejected(run([elysium({ chainId: 0 })]), 2))
  it("rejects record.network disagreeing with the filename", () =>
    expectRejected(run([elysium({ network: "sepolia" })]), 2, /record.network/))
  it("rejects an unknown network filename", () =>
    expectRejected(run([{ fileName: "mainnet.json", data: verifiedRecord({ chainId: 1, network: "mainnet" }) }]), 2))
})

describe("rule 3: required addresses present and non-zero", () => {
  it("rejects a zero core", () => expectRejected(run([elysium({ core: ZERO })]), 3, /core is the zero address/))
  it("rejects a missing bids", () => expectRejected(run([elysium({ bids: undefined })]), 3, /bids is missing/))
  it("rejects a zero marketplace", () => expectRejected(run([elysium({ marketplace: ZERO })]), 3))
})

describe("rule 4: distinct and EIP-55 checksummed", () => {
  it("rejects duplicate addresses", () => expectRejected(run([elysium({ bids: CORE })]), 4, /share address/))
  it("rejects a non-checksummed (lowercase) address", () =>
    expectRejected(run([elysium({ core: "0xabd5209ef11afbbeb42acd09baa844e913eb4bdb" })]), 4, /EIP-55/))
  it("rejects a malformed address", () => expectRejected(run([elysium({ launchpad: "0x1234" })]), 4))
})

describe("rule 5: code at every address", () => {
  it("rejects when an address has no code", async () => {
    const state = healthyChain()
    delete state.code[BIDS]
    await expectRejected(run([elysium()], state), 5, /no code at bids/)
  })
  it("rejects when no RPC is configured for the network", () =>
    expectRejected(run([elysium()], healthyChain(), { readerFor: () => undefined }), 5, /no RPC configured/))
})

describe("rule 6: cohesion", () => {
  it("rejects when bids.core() points elsewhere", async () => {
    const state = healthyChain()
    state.getters[`${BIDS}.core`] = getAddress("0x9999999999999999999999999999999999999999")
    await expectRejected(run([elysium()], state), 6, /bids\.core\(\)/)
  })
  it("rejects when router.bids() points elsewhere", async () => {
    const state = healthyChain()
    state.getters[`${ROUTER}.bids`] = LAUNCHPAD
    await expectRejected(run([elysium()], state), 6, /marketplace\.bids\(\)/)
  })
  it("rejects when a cohesion getter reverts (legacy build has no router())", async () => {
    const state = healthyChain()
    delete state.getters[`${CORE}.router`]
    await expectRejected(run([elysium()], state), 6, /core\.router\(\) failed/)
  })
  it("rejects when launchpad.core() points elsewhere", async () => {
    const state = healthyChain()
    state.getters[`${LAUNCHPAD}.core`] = BIDS
    await expectRejected(run([elysium()], state), 6, /launchpad\.core\(\)/)
  })
})

describe("rule 7: OWNER_QUERY_GAS version fingerprint", () => {
  it("rejects a Core that does not answer OWNER_QUERY_GAS()", async () => {
    const state = healthyChain()
    state.fingerprint = false
    await expectRejected(run([elysium()], state), 7, /legacy build/)
  })
})

describe("rule 8: eth_chainId matches the record", () => {
  it("rejects an RPC serving a different chain, before any other live call", async () => {
    const state = healthyChain()
    state.chainId = 11155111
    const calls: string[] = []
    await expectRejected(run([elysium()], state, { readerFor: () => mockReader(state, calls) }), 8, /eth_chainId 11155111/)
    expect(calls).toEqual(["eth_chainId"])
  })
})

describe("rule 9: no duplicate chainId", () => {
  it("rejects two records claiming the same chainId", () =>
    expectRejected(
      run([
        { fileName: "a.json", data: verifiedRecord({ chainId: 1, network: "a" }) },
        { fileName: "b.json", data: verifiedRecord({ chainId: 1, network: "b" }) },
      ], { ...healthyChain(), chainId: 1 }, { networkChainIds: { a: 1, b: 1 } }),
      9,
      /also claimed by a\.json/,
    ))
})

describe("legacy stack and fail-closed behaviour", () => {
  it("rejects a record shaped like the archived legacy Elysium deployment (rules 1 and 7)", async () => {
    // Same shape as deployments/archive/elysium-2026-11-05-legacy-pre-audit.json:
    // no stage, no configured flag. Its Core does not answer OWNER_QUERY_GAS.
    const legacy: RecordFile = {
      fileName: "elysium.json",
      data: {
        core: CORE,
        bids: BIDS,
        marketplace: ROUTER,
        launchpad: LAUNCHPAD,
        feeReceiver: DEPLOYER,
        marketplaceFee: 100,
        launchFee: 0,
        chainId: 99801,
        network: "elysium",
      },
    }
    const result = await expectRejected(run([legacy], { ...healthyChain(), fingerprint: false }), 1)
    expect(result.errors.some((e) => e.startsWith("[rule 1]"))).toBe(true)
    // Static rejection stops before live checks; prove rule 7 also catches it
    // if the record were (wrongly) promoted.
    await expectRejected(run([elysium()], { ...healthyChain(), fingerprint: false }), 7)
  })

  it("rejects when there are no records at all", async () => {
    const result = await run([])
    expect(result.exitCode).toBe(1)
    expect(existsSync(outPath)).toBe(false)
  })

  it("rejects the whole batch if one record is bad, and leaves an existing file untouched", async () => {
    writeFileSync(outPath, "// previous content\n")
    const result = await run([
      elysium(),
      { fileName: "sepolia.json", data: verifiedRecord({ chainId: 11155111, network: "sepolia", stage: "partial" }) },
    ])
    expect(result.exitCode).toBe(1)
    expect(result.written).toBe(false)
    expect(readFileSync(outPath, "utf8")).toBe("// previous content\n")
  })

  it("reports every failing rule, not just the first", async () => {
    const result = await run([elysium({ stage: "partial", core: ZERO, chainId: 5 })])
    const rules = new Set(result.errors.map((e) => e.match(/^\[rule (\d)\]/)?.[1]))
    expect([...rules].sort()).toEqual(["1", "2", "3"])
  })
})

describe("--check", () => {
  it("passes when the committed file matches", async () => {
    await run([elysium()])
    const result = await run([elysium()], healthyChain(), { check: true })
    expect(result.exitCode).toBe(0)
    expect(result.written).toBe(false)
  })

  it("fails on a stale file without rewriting it", async () => {
    writeFileSync(outPath, "// stale\n")
    const result = await run([elysium()], healthyChain(), { check: true })
    expect(result.exitCode).toBe(1)
    expect(readFileSync(outPath, "utf8")).toBe("// stale\n")
  })

  it("fails when the committed file is missing", async () => {
    const result = await run([elysium()], healthyChain(), { check: true })
    expect(result.exitCode).toBe(1)
    expect(existsSync(outPath)).toBe(false)
  })

  it("still enforces the rules in check mode", () =>
    expectRejected(run([elysium({ stage: "partial" })], healthyChain(), { check: true }), 1))
})

describe("parseRpcEndpoints", () => {
  it("reads [rpc_endpoints] only", () => {
    const toml = '[profile.default]\nsrc = "src"\n\n[rpc_endpoints]\nsepolia = "https://a"\nelysium = "https://b"\n\n[invariant]\nruns = 256\n'
    expect(parseRpcEndpoints(toml)).toEqual({ sepolia: "https://a", elysium: "https://b" })
  })
})
