// prepare-deployment (INTEGRATION_AUDIT §8 step 8, DB-7), offline: the real
// rules 1-4 checker from @marketplace/contracts and in-memory cursor stores.
import { describe, expect, it } from "vitest"
import { checkRecordStatic, type RecordFile } from "@marketplace/contracts/deployment-records"
import { parseArgs, prepareDeployment, PrepareDeploymentError, type PrepareDeploymentDeps, type PrepareDeploymentOptions } from "./prepareDeployment"

const VERIFIED = {
  stage: "verified",
  configured: true,
  chainId: 99801,
  network: "elysium",
  core: "0x1111111111111111111111111111111111111111",
  bids: "0x2222222222222222222222222222222222222222",
  marketplace: "0x3333333333333333333333333333333333333333",
  launchpad: "0x0000000000000000000000000000000000000000",
}

function setup(opts: { record?: Record<string, unknown> | null; lastBlock?: number | null; chainId?: number; cursors?: Record<string, number> } = {}) {
  const state = new Map<number, number | null>()
  if (opts.lastBlock !== undefined) state.set(99801, opts.lastBlock)
  const cursors = new Map<string, number>(Object.entries(opts.cursors ?? {}))
  const writes: string[] = []
  const logs: string[] = []
  const record = opts.record === undefined ? VERIFIED : opts.record
  const deps: PrepareDeploymentDeps = {
    chainId: opts.chainId ?? 99801,
    readRecord: (network) => (record === null ? null : ({ fileName: `${network}.json`, data: record } satisfies RecordFile)),
    checkRecord: (file) => checkRecordStatic(file),
    indexerState: {
      findState: async (chainId) => (state.has(chainId) ? { last_block: state.get(chainId)! } : null),
      setForDeployment: async (chainId, lastBlock) => {
        writes.push(`state:${chainId}:${lastBlock}`)
        state.set(chainId, lastBlock)
      },
    },
    contractState: {
      seedIfMissing: async (address, chainId, lastBlock) => {
        if (cursors.has(address)) return false
        writes.push(`cursor:${address}:${chainId}:${lastBlock}`)
        cursors.set(address, lastBlock)
        return true
      },
    },
    collections: {
      getAll: async () => [
        { contract_address: "0xaaaa", indexer_block: 500 },
        { contract_address: "0xbbbb", indexer_block: null },
      ],
    },
    log: (m) => logs.push(m),
  }
  return { deps, state, cursors, writes, logs }
}

const opts = (o: Partial<PrepareDeploymentOptions> = {}): PrepareDeploymentOptions => ({ network: "elysium", force: false, dryRun: false, deployBlock: 1000, ...o })

describe("prepare-deployment: refusals (nothing is written)", () => {
  it.each([
    ["no record", { record: null }, opts(), /no deployment record/],
    ["stage=partial", { record: { ...VERIFIED, stage: "partial" } }, opts(), /rule 1.*stage/],
    ["configured=false", { record: { ...VERIFIED, configured: false } }, opts(), /rule 1.*configured/],
    ["non-checksummed address", { record: { ...VERIFIED, core: VERIFIED.core.replace("1111", "abcd") } }, opts(), /rule 4/],
    ["record chain != CHAIN_ID", { chainId: 11155111 }, opts(), /does not match this indexer's CHAIN_ID 11155111/],
    ["no deploy block anywhere", {}, opts({ deployBlock: undefined }), /no deployBlock; pass --deploy-block/],
    ["deploy block 0", {}, opts({ deployBlock: 0 }), /not a positive integer/],
    ["record deployBlock disagrees", { record: { ...VERIFIED, deployBlock: 999 } }, opts(), /disagrees with the record's deployBlock 999/],
    ["lowering without --force", { lastBlock: 5000 }, opts(), /refusing to lower it to 999 without --force/],
  ])("%s", async (_name, setupOpts, options, message) => {
    const { deps, writes } = setup(setupOpts as never)
    await expect(prepareDeployment(options, deps)).rejects.toThrow(PrepareDeploymentError)
    await expect(prepareDeployment(options, deps)).rejects.toThrow(message)
    expect(writes).toEqual([])
  })
})

describe("prepare-deployment: effects", () => {
  it("fresh chain: creates indexer_state at deployBlock - 1 and seeds collection cursors", async () => {
    const { deps, writes, state } = setup()
    const result = await prepareDeployment(opts(), deps)
    expect(state.get(99801)).toBe(999)
    expect(writes).toEqual(["state:99801:999", "cursor:0xaaaa:99801:499", "cursor:0xbbbb:99801:999"])
    expect(result).toMatchObject({ deployBlock: 1000, previousLastBlock: null, lastBlock: 999, indexerStateChanged: true, seededCollections: ["0xaaaa", "0xbbbb"] })
  })

  it("raising an older cursor (moving off a legacy deployment) needs no --force", async () => {
    const { deps, state } = setup({ lastBlock: 16454480 })
    await prepareDeployment(opts({ deployBlock: 24721527 }), deps)
    expect(state.get(99801)).toBe(24721526)
  })

  it("--force lowers an existing cursor", async () => {
    const { deps, state } = setup({ lastBlock: 5000 })
    await prepareDeployment(opts({ force: true }), deps)
    expect(state.get(99801)).toBe(999)
  })

  it("is idempotent: a second run writes nothing", async () => {
    const { deps, writes } = setup()
    await prepareDeployment(opts(), deps)
    writes.length = 0
    const again = await prepareDeployment(opts(), deps)
    expect(writes).toEqual([])
    expect(again).toMatchObject({ indexerStateChanged: false, seededCollections: [] })
  })

  it("never touches an existing collection cursor", async () => {
    const { deps, cursors } = setup({ cursors: { "0xaaaa": 7 } })
    const result = await prepareDeployment(opts(), deps)
    expect(cursors.get("0xaaaa")).toBe(7)
    expect(result.seededCollections).toEqual(["0xbbbb"])
  })

  it("uses the record's deployBlock when present (the flag may be omitted or equal)", async () => {
    const { deps, state } = setup({ record: { ...VERIFIED, deployBlock: 1234 } })
    await prepareDeployment(opts({ deployBlock: undefined }), deps)
    expect(state.get(99801)).toBe(1233)
  })

  it("--dry-run writes nothing and reports the plan", async () => {
    const { deps, writes, logs } = setup({ lastBlock: 10 })
    const result = await prepareDeployment(opts({ dryRun: true }), deps)
    expect(writes).toEqual([])
    expect(result).toMatchObject({ dryRun: true, previousLastBlock: 10, lastBlock: 999 })
    expect(logs[0]).toMatch(/^\[dry-run\] would set indexer_state\(chain 99801\)\.last_block 10 -> 999/)
  })
})

describe("prepare-deployment: CLI arguments", () => {
  it("parses the flags (pnpm's -- separator is ignored)", () => {
    expect(parseArgs(["--", "--network", "elysium", "--deploy-block", "42", "--force", "--dry-run"])).toEqual({
      network: "elysium",
      deployBlock: 42,
      force: true,
      dryRun: true,
    })
  })

  it.each([[["--deploy-block", "1"]], [["--network", "elysium", "--deploy-block", "1e6"]], [["--network", "elysium", "--bogus"]], [["--network", "../x"]]])(
    "rejects %j",
    (argv) => {
      expect(() => parseArgs(argv)).toThrow(PrepareDeploymentError)
    },
  )
})
