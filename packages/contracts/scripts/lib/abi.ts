import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { keccak256, stringToBytes, type Abi, type AbiParameter, type Hex } from "viem"

// ─────────────────────────────────────────────────────────────────────────────
// ABI generation from Foundry artifacts (INTEGRATION_AUDIT §4.4).
// Pure-ish helpers shared by scripts/generate-abis.ts and its tests.
// ─────────────────────────────────────────────────────────────────────────────

export type AbiItem = Abi[number]

/** One contract artifact to read: foundry/out/<file>/<contract>.json */
export interface ArtifactSpec {
  /** Export-name prefix, e.g. "MarketplaceCore" → MarketplaceCoreAbi */
  readonly name: string
  /** Solidity file under foundry/src, e.g. "MarketplaceCore.sol" */
  readonly file: string
  /** Contract name inside that file, e.g. "Hyperc" for MERC721.sol */
  readonly contract: string
}

export interface LoadedArtifact {
  readonly spec: ArtifactSpec
  readonly abi: AbiItem[]
  readonly solc: string
  readonly sourcePath: string
  /** keccak256 over LF-normalized content of every source in the compilation. */
  readonly sourceHash: Hex
}

export type BundleEntry =
  | { readonly kind: "full"; readonly artifact: string; readonly exportName: string }
  | { readonly kind: "events"; readonly artifact: string; readonly exportName: string; readonly only?: readonly string[] }

export interface BundleSpec {
  /** Output filename inside src/abis, e.g. "events.generated.ts" */
  readonly fileName: string
  readonly description: string
  readonly entries: readonly BundleEntry[]
}

export const ARTIFACTS: readonly ArtifactSpec[] = [
  { name: "Marketplace", file: "Marketplace.sol", contract: "Marketplace" },
  { name: "MarketplaceCore", file: "MarketplaceCore.sol", contract: "MarketplaceCore" },
  { name: "MarketplaceBids", file: "MarketplaceBids.sol", contract: "MarketplaceBids" },
  { name: "LaunchPad", file: "LaunchPad.sol", contract: "LaunchPad" },
  { name: "Hyperc", file: "MERC721.sol", contract: "Hyperc" },
]

export const BUNDLES: readonly BundleSpec[] = [
  {
    fileName: "events.generated.ts",
    description: "Events-only bundle for the indexer: Core + Bids + ERC-721 Transfer.",
    entries: [
      { kind: "events", artifact: "MarketplaceCore", exportName: "MarketplaceCoreEventsAbi" },
      { kind: "events", artifact: "MarketplaceBids", exportName: "MarketplaceBidsEventsAbi" },
      { kind: "events", artifact: "Hyperc", exportName: "Erc721TransferEventAbi", only: ["Transfer"] },
    ],
  },
  {
    fileName: "full.generated.ts",
    description: "Complete ABIs (functions, events, errors) for the web app.",
    entries: [
      { kind: "full", artifact: "Marketplace", exportName: "MarketplaceAbi" },
      { kind: "full", artifact: "MarketplaceCore", exportName: "MarketplaceCoreAbi" },
      { kind: "full", artifact: "MarketplaceBids", exportName: "MarketplaceBidsAbi" },
    ],
  },
  {
    fileName: "launchpad.generated.ts",
    description: "LaunchPad factory ABI (per-feature bundle).",
    entries: [{ kind: "full", artifact: "LaunchPad", exportName: "LaunchPadAbi" }],
  },
  {
    fileName: "collection.generated.ts",
    description: "Hyperc collection (MERC721.sol) ABI (per-feature bundle).",
    entries: [{ kind: "full", artifact: "Hyperc", exportName: "HypercAbi" }],
  },
]

const DROPPED_TYPES = new Set(["constructor", "fallback", "receive"])

// ─── Normalization ──────────────────────────────────────────────────────────

/** Canonical Solidity type, expanding tuples: (address,uint128)[] */
export function canonicalType(param: AbiParameter): string {
  if (param.type.startsWith("tuple")) {
    const components = "components" in param && param.components ? param.components : []
    return `(${components.map(canonicalType).join(",")})${param.type.slice("tuple".length)}`
  }
  return param.type
}

export function signatureOf(item: AbiItem): string {
  const name = "name" in item ? item.name : ""
  const inputs = "inputs" in item && item.inputs ? item.inputs : []
  return `${name}(${inputs.map(canonicalType).join(",")})`
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Recursively sort object keys so output does not depend on artifact key order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort(compareStrings)) {
      out[key] = sortKeys((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** Drop constructor/fallback/receive and sort by (type, name, signature). */
export function normalizeAbi(abi: readonly AbiItem[]): AbiItem[] {
  return abi
    .filter((item) => !DROPPED_TYPES.has(item.type))
    .map((item) => sortKeys(item) as AbiItem)
    .sort(
      (a, b) =>
        compareStrings(a.type, b.type) ||
        compareStrings("name" in a ? (a.name ?? "") : "", "name" in b ? (b.name ?? "") : "") ||
        compareStrings(signatureOf(a), signatureOf(b)),
    )
}

// ─── Source hashing ─────────────────────────────────────────────────────────

/** Line endings differ between a Windows (autocrlf) checkout and Linux CI. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, "\n")
}

/**
 * Hash every source file of the compilation unit, LF-normalized, so the stamp
 * is identical on every OS. solc's own metadata keccak256 is not: it hashes the
 * bytes on disk, which include CRLF on Windows checkouts.
 */
export function hashSources(sourcePaths: readonly string[], readSource: (p: string) => string): Hex {
  const lines = [...sourcePaths]
    .sort(compareStrings)
    .map((p) => `${p}\0${keccak256(stringToBytes(normalizeEol(readSource(p))))}\n`)
  return keccak256(stringToBytes(lines.join("")))
}

// ─── Loading ────────────────────────────────────────────────────────────────

interface FoundryArtifact {
  abi: AbiItem[]
  metadata?: { compiler?: { version?: string }; sources?: Record<string, unknown> }
}

export function artifactPath(outDir: string, spec: ArtifactSpec): string {
  return path.join(outDir, spec.file, `${spec.contract}.json`)
}

export function loadArtifact(foundryRoot: string, outDir: string, spec: ArtifactSpec): LoadedArtifact {
  const file = artifactPath(outDir, spec)
  if (!existsSync(file)) {
    throw new Error(`Missing Foundry artifact ${file}. Run \`forge build\` in packages/contracts/foundry first.`)
  }
  const json = JSON.parse(readFileSync(file, "utf8")) as FoundryArtifact
  const solc = json.metadata?.compiler?.version
  const sources = json.metadata?.sources
  if (!Array.isArray(json.abi) || !solc || !sources) {
    throw new Error(`Artifact ${file} has no abi/metadata. Rebuild with \`forge build\`.`)
  }
  const sourceHash = hashSources(Object.keys(sources), (p) => readFileSync(path.join(foundryRoot, p), "utf8"))
  return { spec, abi: json.abi, solc, sourcePath: `src/${spec.file}`, sourceHash }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function selectItems(entry: BundleEntry, artifact: LoadedArtifact): AbiItem[] {
  const normalized = normalizeAbi(artifact.abi)
  if (entry.kind === "full") return normalized
  const events = normalized.filter((item) => item.type === "event")
  if (!entry.only) return events
  const picked = events.filter((item) => "name" in item && entry.only!.includes(item.name))
  const missing = entry.only.filter((n) => !picked.some((item) => "name" in item && item.name === n))
  if (missing.length > 0) {
    throw new Error(`${artifact.spec.contract} has no event(s): ${missing.join(", ")}`)
  }
  return picked
}

export function renderBundle(bundle: BundleSpec, artifacts: ReadonlyMap<string, LoadedArtifact>): string {
  const used = [...new Set(bundle.entries.map((e) => e.artifact))].map((name) => {
    const artifact = artifacts.get(name)
    if (!artifact) throw new Error(`Bundle ${bundle.fileName} references unknown artifact ${name}`)
    return artifact
  })
  const solcVersions = [...new Set(used.map((a) => a.solc))]

  const header = [
    "// ─────────────────────────────────────────────────────────────────────────────",
    "// AUTO-GENERATED by packages/contracts/scripts/generate-abis.ts. DO NOT EDIT.",
    "// Regenerate: forge build && pnpm --filter @marketplace/contracts generate:abis",
    `// ${bundle.description}`,
    `// solc: ${solcVersions.join(", ")}`,
    "// sources (keccak256 over LF-normalized compilation sources):",
    ...used.map((a) => `//   ${a.spec.contract.padEnd(16)} ${a.sourcePath.padEnd(26)} ${a.sourceHash}`),
    "// ─────────────────────────────────────────────────────────────────────────────",
  ]

  const body = bundle.entries.map((entry) => {
    const items = selectItems(entry, artifacts.get(entry.artifact)!)
    return `export const ${entry.exportName} = ${JSON.stringify(items, null, 2)} as const satisfies Abi\n`
  })

  return [...header, "", 'import type { Abi } from "viem"', "", body.join("\n")].join("\n")
}

/** Generate every bundle in memory: fileName → content. */
export function generateAbiFiles(
  foundryRoot: string,
  outDir: string,
  artifacts: readonly ArtifactSpec[] = ARTIFACTS,
  bundles: readonly BundleSpec[] = BUNDLES,
): Map<string, string> {
  const loaded = new Map(artifacts.map((spec) => [spec.name, loadArtifact(foundryRoot, outDir, spec)] as const))
  return new Map(bundles.map((bundle) => [bundle.fileName, renderBundle(bundle, loaded)] as const))
}

/** Return the file names whose committed content differs from `generated`. */
export function diffGenerated(generated: ReadonlyMap<string, string>, abisDir: string): string[] {
  const stale: string[] = []
  for (const [fileName, content] of generated) {
    const file = path.join(abisDir, fileName)
    if (!existsSync(file) || normalizeEol(readFileSync(file, "utf8")) !== content) stale.push(fileName)
  }
  return stale
}
