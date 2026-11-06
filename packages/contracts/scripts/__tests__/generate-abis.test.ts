// Test #5 (INTEGRATION_AUDIT §10): generator determinism and --check.
// Uses fixture artifacts in a temp dir; CI additionally runs the real
// `generate:abis --check` against `forge build` output.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  diffGenerated,
  generateAbiFiles,
  hashSources,
  normalizeAbi,
  type AbiItem,
  type ArtifactSpec,
  type BundleSpec,
} from "../lib/abi"

const SPECS: ArtifactSpec[] = [{ name: "Thing", file: "Thing.sol", contract: "Thing" }]
const BUNDLES: BundleSpec[] = [
  {
    fileName: "thing.generated.ts",
    description: "fixture",
    entries: [
      { kind: "full", artifact: "Thing", exportName: "ThingAbi" },
      { kind: "events", artifact: "Thing", exportName: "ThingEventsAbi" },
    ],
  },
]

const ABI: AbiItem[] = [
  { type: "constructor", inputs: [], stateMutability: "nonpayable" },
  { type: "receive", stateMutability: "payable" },
  { type: "fallback", stateMutability: "payable" },
  {
    type: "function",
    name: "set",
    inputs: [{ name: "a", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "set",
    inputs: [{ name: "a", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Zed",
    inputs: [{ name: "x", type: "uint256", indexed: false }],
    anonymous: false,
  },
  {
    type: "event",
    name: "Alpha",
    inputs: [{ name: "who", type: "address", indexed: true }],
    anonymous: false,
  },
  { type: "error", name: "Nope", inputs: [] },
]

let root: string
let outDir: string
let abisDir: string

function writeFixture(abi: AbiItem[], source = "contract Thing {}\n") {
  mkdirSync(path.join(outDir, "Thing.sol"), { recursive: true })
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "Thing.sol"), source)
  writeFileSync(
    path.join(outDir, "Thing.sol", "Thing.json"),
    JSON.stringify({
      abi,
      metadata: { compiler: { version: "0.8.24+commit.e11b9ed9" }, sources: { "src/Thing.sol": {} } },
    }),
  )
}

function generate() {
  return generateAbiFiles(root, outDir, SPECS, BUNDLES)
}

function writeGenerated(files: Map<string, string>) {
  mkdirSync(abisDir, { recursive: true })
  for (const [name, content] of files) writeFileSync(path.join(abisDir, name), content)
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "gen-abis-"))
  outDir = path.join(root, "out")
  abisDir = path.join(root, "abis")
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("normalizeAbi", () => {
  it("drops constructor, fallback and receive", () => {
    const types = normalizeAbi(ABI).map((i) => i.type)
    expect(types).not.toContain("constructor")
    expect(types).not.toContain("fallback")
    expect(types).not.toContain("receive")
  })

  it("sorts by (type, name, signature)", () => {
    const keys = normalizeAbi(ABI).map((i) => `${i.type}:${"name" in i ? i.name : ""}:${JSON.stringify("inputs" in i ? i.inputs : [])}`)
    expect(keys.map((k) => k.split(":").slice(0, 2).join(":"))).toEqual([
      "error:Nope",
      "event:Alpha",
      "event:Zed",
      "function:set",
      "function:set",
    ])
    // set(address) sorts before set(uint256)
    const sets = normalizeAbi(ABI).filter((i) => i.type === "function")
    expect(sets.map((i) => ("inputs" in i ? i.inputs[0].type : ""))).toEqual(["address", "uint256"])
  })

  it("is independent of input order", () => {
    const shuffled = [...ABI].reverse()
    expect(JSON.stringify(normalizeAbi(shuffled))).toBe(JSON.stringify(normalizeAbi(ABI)))
  })
})

describe("hashSources", () => {
  it("is identical for CRLF and LF checkouts", () => {
    const lf = hashSources(["a.sol"], () => "line1\nline2\n")
    const crlf = hashSources(["a.sol"], () => "line1\r\nline2\r\n")
    expect(crlf).toBe(lf)
  })

  it("changes when a source changes", () => {
    expect(hashSources(["a.sol"], () => "x")).not.toBe(hashSources(["a.sol"], () => "y"))
  })
})

describe("generateAbiFiles", () => {
  it("stamps solc version and source hash in the header", () => {
    writeFixture(ABI)
    const content = generate().get("thing.generated.ts")!
    expect(content).toContain("AUTO-GENERATED")
    expect(content).toContain("// solc: 0.8.24+commit.e11b9ed9")
    expect(content).toMatch(/Thing\s+src\/Thing\.sol\s+0x[0-9a-f]{64}/)
    expect(content).toContain("export const ThingAbi = [")
    expect(content).toContain("] as const satisfies Abi")
    expect(content).not.toContain("\r")
  })

  it("emits only events in an events bundle", () => {
    writeFixture(ABI)
    const content = generate().get("thing.generated.ts")!
    const events = content.slice(content.indexOf("export const ThingEventsAbi"))
    expect(events).toContain('"name": "Alpha"')
    expect(events).not.toContain('"type": "function"')
    expect(events).not.toContain('"type": "error"')
  })

  it("produces byte-identical output for shuffled artifacts", () => {
    writeFixture(ABI)
    const a = generate().get("thing.generated.ts")
    writeFixture([...ABI].reverse())
    expect(generate().get("thing.generated.ts")).toBe(a)
  })

  it("fails clearly when the artifact is missing", () => {
    expect(() => generate()).toThrow(/forge build/)
  })
})

describe("--check (diffGenerated)", () => {
  it("passes when committed files match a fresh regeneration", () => {
    writeFixture(ABI)
    writeGenerated(generate())
    expect(diffGenerated(generate(), abisDir)).toEqual([])
  })

  it("tolerates CRLF in the committed file", () => {
    writeFixture(ABI)
    const files = generate()
    writeGenerated(new Map([...files].map(([k, v]) => [k, v.replace(/\n/g, "\r\n")])))
    expect(diffGenerated(generate(), abisDir)).toEqual([])
  })

  it("reports a hand-edited committed file and does not rewrite it", () => {
    writeFixture(ABI)
    writeGenerated(generate())
    const file = path.join(abisDir, "thing.generated.ts")
    const edited = readFileSync(file, "utf8").replace('"Alpha"', '"Renamed"')
    writeFileSync(file, edited)
    expect(diffGenerated(generate(), abisDir)).toEqual(["thing.generated.ts"])
    expect(readFileSync(file, "utf8")).toBe(edited)
  })

  it("reports drift when the contract ABI changes", () => {
    writeFixture(ABI)
    writeGenerated(generate())
    writeFixture(ABI.filter((i) => !("name" in i && i.name === "Zed")))
    expect(diffGenerated(generate(), abisDir)).toEqual(["thing.generated.ts"])
  })

  it("reports drift when a source changes but the ABI does not", () => {
    writeFixture(ABI)
    writeGenerated(generate())
    writeFixture(ABI, "contract Thing { /* changed */ }\n")
    expect(diffGenerated(generate(), abisDir)).toEqual(["thing.generated.ts"])
  })

  it("reports a missing committed file", () => {
    writeFixture(ABI)
    expect(diffGenerated(generate(), abisDir)).toEqual(["thing.generated.ts"])
  })
})
