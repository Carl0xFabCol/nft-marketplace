import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem"
import { normalizeEol } from "./abi"

// ─────────────────────────────────────────────────────────────────────────────
// Address generation from VERIFIED deployment records (INTEGRATION_AUDIT §3.3).
//
// Rule 10 (provenance: deployBlock, verifiedAt, creation-code hashes equal to
// the local Foundry artifacts) was added in Phase 5 (audit §8.3).
//
// Rejects, with a non-zero exit and NO file write, unless every rule holds for
// every record consumed. All rules are evaluated and all failures reported.
// The RPC layer is injected (ChainReader) so the rules are testable offline.
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors DeploymentConfig.sol network selection (ELYSIUM_CHAIN_ID / SEPOLIA_CHAIN_ID). */
export const NETWORK_CHAIN_IDS: Readonly<Record<string, number>> = {
  elysium: 99801,
  sepolia: 11155111,
}

/**
 * Deployment components and the Foundry artifact each one is built from
 * (foundry/out/<Name>.sol/<Name>.json). Rule 10 compares the record's
 * `<component>CodeHash` with keccak256 of that artifact's bytecode.object.
 */
export const COMPONENT_ARTIFACTS = {
  core: "MarketplaceCore",
  bids: "MarketplaceBids",
  marketplace: "Marketplace",
  launchpad: "LaunchPad",
} as const
export type Component = keyof typeof COMPONENT_ARTIFACTS

export type AddressGetter = "core" | "bids" | "marketplace" | "router" | "bidsContract"

/** Minimal read-only chain access needed by rules 5-8. */
export interface ChainReader {
  getChainId(): Promise<number>
  /** Deployed bytecode, "0x" or undefined when the account has no code. */
  getCode(address: Address): Promise<Hex | undefined>
  /** Calls `<fn>() returns (address)`; throws if the call reverts/does not exist. */
  readAddress(contract: Address, fn: AddressGetter): Promise<Address>
  /** Calls `<fn>() returns (uint256)`; throws if the call reverts/does not exist. */
  readUint(contract: Address, fn: "OWNER_QUERY_GAS"): Promise<bigint>
}

/** A deployments/<network>.json file, already parsed. */
export interface RecordFile {
  /** e.g. "elysium.json" */
  readonly fileName: string
  readonly data: unknown
}

export interface VerifiedDeployment {
  readonly network: string
  readonly chainId: number
  readonly core: Address
  readonly bids: Address
  readonly marketplace: Address
  readonly launchpad?: Address
  readonly deployer?: Address
  /** VerifyDeployment's block.timestamp (unix seconds); required by rule 10. */
  readonly verifiedAt?: number
  /** Lower bound for the first deployment tx (DeployMarketplace); required by rule 10. */
  readonly deployBlock?: number
}

export interface GenerateAddressesOptions {
  readonly records: readonly RecordFile[]
  /** Returns the reader for a network, or undefined when no RPC is configured. */
  readonly readerFor: (network: string, chainId: number) => ChainReader | undefined
  readonly networkChainIds?: Readonly<Record<string, number>>
  /**
   * keccak256 of the component's artifact bytecode.object, or undefined when
   * the artifact is missing (rule 10). Required: there is no way to skip the
   * artifact check.
   */
  readonly artifactHash: (component: Component) => Hex | undefined
}

export type ValidationResult =
  | { readonly ok: true; readonly deployments: VerifiedDeployment[] }
  | { readonly ok: false; readonly errors: string[] }

// ─── Rules ──────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>

function networkFromFileName(fileName: string): string {
  return fileName.replace(/\.json$/i, "")
}

function isChecksummed(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value, { strict: false }) && getAddress(value) === value
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** Rules 1-4: everything that can be checked without RPC. */
function checkStatic(file: RecordFile, chainIds: Readonly<Record<string, number>>, errors: string[]): VerifiedDeployment | undefined {
  const network = networkFromFileName(file.fileName)
  const fail = (rule: number, msg: string) => errors.push(`[rule ${rule}] ${file.fileName}: ${msg}`)
  const before = errors.length

  if (!file.data || typeof file.data !== "object" || Array.isArray(file.data)) {
    fail(1, "record is not a JSON object")
    return undefined
  }
  const r = file.data as Raw

  // Rule 1 — only VerifyDeployment writes stage=verified + configured=true.
  if (r.stage !== "verified") fail(1, `stage is ${JSON.stringify(r.stage)}, expected "verified"`)
  if (r.configured !== true) fail(1, `configured is ${JSON.stringify(r.configured)}, expected true`)

  // Rule 2 — chainId positive integer matching the network the filename encodes.
  const expectedChainId = chainIds[network]
  if (expectedChainId === undefined) fail(2, `unknown network "${network}" (known: ${Object.keys(chainIds).join(", ")})`)
  if (typeof r.chainId !== "number" || !Number.isSafeInteger(r.chainId) || r.chainId <= 0) {
    fail(2, `chainId ${JSON.stringify(r.chainId)} is not a positive integer`)
  } else if (expectedChainId !== undefined && r.chainId !== expectedChainId) {
    fail(2, `chainId ${r.chainId} does not match network "${network}" (${expectedChainId})`)
  }
  if (r.network !== undefined && r.network !== network) {
    fail(2, `record.network ${JSON.stringify(r.network)} does not match filename network "${network}"`)
  }

  // Rule 3 — core/bids/marketplace present and non-zero; launchpad absent or non-zero.
  // DeploymentConfig always serializes `launchpad`; the zero address means absent.
  const required = ["core", "bids", "marketplace"] as const
  for (const key of required) {
    const v = r[key]
    if (typeof v !== "string" || v.length === 0) fail(3, `${key} is missing`)
    else if (isAddress(v, { strict: false }) && sameAddress(v, zeroAddress)) fail(3, `${key} is the zero address`)
  }
  const launchpadRaw = r.launchpad
  const hasLaunchpad =
    launchpadRaw !== undefined &&
    launchpadRaw !== null &&
    !(typeof launchpadRaw === "string" && isAddress(launchpadRaw, { strict: false }) && sameAddress(launchpadRaw, zeroAddress))

  // Rule 4 — all addresses distinct and EIP-55 checksummed.
  const present: [string, unknown][] = required.map((k) => [k, r[k]])
  if (hasLaunchpad) present.push(["launchpad", launchpadRaw])
  for (const [key, v] of present) {
    if (typeof v === "string" && v.length > 0 && !isChecksummed(v)) fail(4, `${key} ${v} is not an EIP-55 checksummed address`)
  }
  const seen = new Map<string, string>()
  for (const [key, v] of present) {
    if (typeof v !== "string") continue
    const prior = seen.get(v.toLowerCase())
    if (prior) fail(4, `${key} and ${prior} share address ${v}`)
    else seen.set(v.toLowerCase(), key)
  }

  if (errors.length > before) return undefined
  return {
    network,
    chainId: r.chainId as number,
    core: r.core as Address,
    bids: r.bids as Address,
    marketplace: r.marketplace as Address,
    launchpad: hasLaunchpad ? (launchpadRaw as Address) : undefined,
    deployer: isChecksummed(r.deployer) ? r.deployer : undefined,
    verifiedAt: isPositiveInt(r.verifiedAt) ? r.verifiedAt : undefined,
    deployBlock: isPositiveInt(r.deployBlock) ? r.deployBlock : undefined,
  }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

const HASH = /^0x[0-9a-fA-F]{64}$/
const ZERO_HASH = /^0x0{64}$/

/**
 * Rule 10 (audit §8.3): provenance. The record must carry a deployBlock and a
 * verifiedAt, and each component's creation-code hash recorded at deploy time
 * must equal the hash of the artifact this generator (and every consumer of
 * the generated ABIs) is built from. A stack deployed from different bytecode
 * is rejected here instead of being activated next to mismatched ABIs.
 */
function checkProvenance(file: RecordFile, d: VerifiedDeployment, artifactHash: (c: Component) => Hex | undefined, errors: string[]): void {
  const fail = (msg: string) => errors.push(`[rule 10] ${file.fileName}: ${msg}`)
  const r = file.data as Raw
  if (!isPositiveInt(r.deployBlock)) fail(`deployBlock ${JSON.stringify(r.deployBlock)} is not a positive integer`)
  if (!isPositiveInt(r.verifiedAt)) fail(`verifiedAt ${JSON.stringify(r.verifiedAt)} is not a positive integer`)

  const components: Component[] = ["core", "bids", "marketplace"]
  if (d.launchpad) components.push("launchpad")
  for (const c of components) {
    const key = `${c}CodeHash`
    const recorded = r[key]
    if (typeof recorded !== "string" || !HASH.test(recorded) || ZERO_HASH.test(recorded)) {
      fail(`${key} ${JSON.stringify(recorded)} is missing or not a non-zero 32-byte hash`)
      continue
    }
    const expected = artifactHash(c)
    if (!expected) {
      fail(`no artifact for ${c} (${COMPONENT_ARTIFACTS[c]}); run forge build`)
    } else if (recorded.toLowerCase() !== expected.toLowerCase()) {
      fail(`${key} ${recorded} does not match the ${COMPONENT_ARTIFACTS[c]} artifact (${expected}): the deployed bytecode is not the build these ABIs come from`)
    }
  }
}

async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.split("\n")[0] : String(error) }
  }
}

/** Rules 5-8: live checks against the record's chain. */
async function checkLive(d: VerifiedDeployment, fileName: string, reader: ChainReader, errors: string[]): Promise<void> {
  const fail = (rule: number, msg: string) => errors.push(`[rule ${rule}] ${fileName}: ${msg}`)

  // Rule 8 — the RPC must serve the record's chain. Checked first: if it is the
  // wrong chain, every other live answer is meaningless.
  const chainId = await attempt(() => reader.getChainId())
  if (!chainId.ok) {
    fail(8, `eth_chainId failed: ${chainId.error}`)
    return
  }
  if (chainId.value !== d.chainId) {
    fail(8, `RPC eth_chainId ${chainId.value} does not match record chainId ${d.chainId}`)
    return
  }

  // Rule 5 — code at every address.
  const contracts: [string, Address][] = [
    ["core", d.core],
    ["bids", d.bids],
    ["marketplace", d.marketplace],
  ]
  if (d.launchpad) contracts.push(["launchpad", d.launchpad])
  let allHaveCode = true
  for (const [key, address] of contracts) {
    const code = await attempt(() => reader.getCode(address))
    if (!code.ok) {
      fail(5, `eth_getCode(${key} ${address}) failed: ${code.error}`)
      allHaveCode = false
    } else if (!code.value || code.value === "0x") {
      fail(5, `no code at ${key} ${address}`)
      allHaveCode = false
    }
  }
  if (!allHaveCode) return

  // Rule 6 — cohesion: every component points at the others.
  const cohesion: [string, Address, AddressGetter, Address][] = [
    ["bids", d.bids, "core", d.core],
    ["bids", d.bids, "marketplace", d.marketplace],
    ["marketplace", d.marketplace, "core", d.core],
    ["marketplace", d.marketplace, "bids", d.bids],
    ["core", d.core, "router", d.marketplace],
    ["core", d.core, "bidsContract", d.bids],
  ]
  if (d.launchpad) cohesion.push(["launchpad", d.launchpad, "core", d.core])
  for (const [key, address, fn, expected] of cohesion) {
    const actual = await attempt(() => reader.readAddress(address, fn))
    if (!actual.ok) fail(6, `${key}.${fn}() failed: ${actual.error}`)
    else if (!sameAddress(actual.value, expected)) fail(6, `${key}.${fn}() is ${actual.value}, expected ${expected}`)
  }

  // Rule 7 — version fingerprint: absent on the legacy (pre-audit) Core build.
  const fingerprint = await attempt(() => reader.readUint(d.core, "OWNER_QUERY_GAS"))
  if (!fingerprint.ok) fail(7, `core.OWNER_QUERY_GAS() did not answer (legacy build?): ${fingerprint.error}`)
}

/**
 * Rules 1-4 only (no RPC) for ONE record: stage=verified + configured, chainId
 * matches the network, required addresses present, distinct and checksummed.
 * Used by the indexer's prepare-deployment (INTEGRATION_AUDIT §8 step 8),
 * which must refuse an unverified record without needing a live RPC.
 */
export function checkRecordStatic(
  file: RecordFile,
  chainIds: Readonly<Record<string, number>> = NETWORK_CHAIN_IDS,
): { readonly ok: true; readonly deployment: VerifiedDeployment } | { readonly ok: false; readonly errors: string[] } {
  const errors: string[] = []
  const deployment = checkStatic(file, chainIds, errors)
  return deployment && errors.length === 0 ? { ok: true, deployment } : { ok: false, errors }
}

export async function validateRecords(options: GenerateAddressesOptions): Promise<ValidationResult> {
  const chainIds = options.networkChainIds ?? NETWORK_CHAIN_IDS
  const errors: string[] = []

  if (options.records.length === 0) {
    return { ok: false, errors: ["no deployment records to consume"] }
  }

  const candidates: { file: RecordFile; deployment: VerifiedDeployment }[] = []
  for (const file of options.records) {
    const deployment = checkStatic(file, chainIds, errors)
    if (deployment) {
      checkProvenance(file, deployment, options.artifactHash, errors)
      candidates.push({ file, deployment })
    }
  }

  // Rule 9 — no two records share a chainId (checked on the raw records so a
  // duplicate is reported even when one of them also fails another rule).
  const byChain = new Map<number, string>()
  for (const file of options.records) {
    const chainId = (file.data as Raw | null)?.chainId
    if (typeof chainId !== "number") continue
    const prior = byChain.get(chainId)
    if (prior) errors.push(`[rule 9] ${file.fileName}: chainId ${chainId} is also claimed by ${prior}`)
    else byChain.set(chainId, file.fileName)
  }

  for (const { file, deployment } of candidates) {
    const reader = options.readerFor(deployment.network, deployment.chainId)
    if (!reader) {
      errors.push(`[rule 5] ${file.fileName}: no RPC configured for network "${deployment.network}"; live checks cannot run`)
      continue
    }
    await checkLive(deployment, file.fileName, reader, errors)
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, deployments: candidates.map((c) => c.deployment).sort((a, b) => a.chainId - b.chainId) }
}

/** Parse the [rpc_endpoints] table of foundry.toml (simple `name = "url"` lines). */
export function parseRpcEndpoints(toml: string): Record<string, string> {
  const out: Record<string, string> = {}
  let inSection = false
  for (const line of toml.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (header) {
      inSection = header[1].trim() === "rpc_endpoints"
      continue
    }
    if (!inSection) continue
    const kv = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/)
    if (kv) out[kv[1]] = kv[2]
  }
  return out
}

// ─── Rendering ──────────────────────────────────────────────────────────────

export function renderAddresses(deployments: readonly VerifiedDeployment[]): string {
  const sorted = [...deployments].sort((a, b) => a.chainId - b.chainId)
  const addressLines: string[] = []
  const metadataLines: string[] = []
  for (const d of sorted) {
    addressLines.push(`  ${d.chainId}: {`)
    addressLines.push(`    MARKETPLACE: "${d.marketplace}",`)
    addressLines.push(`    MARKETPLACE_BIDS: "${d.bids}",`)
    addressLines.push(`    MARKETPLACE_CORE: "${d.core}",`)
    if (d.launchpad) addressLines.push(`    LAUNCHPAD: "${d.launchpad}",`)
    addressLines.push("  },")

    metadataLines.push(`  ${d.chainId}: {`)
    metadataLines.push(`    network: "${d.network}",`)
    metadataLines.push(`    chainId: ${d.chainId},`)
    metadataLines.push(`    core: "${d.core}",`)
    metadataLines.push(`    bids: "${d.bids}",`)
    metadataLines.push(`    marketplace: "${d.marketplace}",`)
    metadataLines.push(`    launchpad: ${d.launchpad ? `"${d.launchpad}"` : "null"},`)
    metadataLines.push(`    deployer: ${d.deployer ? `"${d.deployer}"` : "null"},`)
    metadataLines.push(`    deployBlock: ${d.deployBlock ?? "null"},`)
    metadataLines.push(`    verifiedAt: ${d.verifiedAt ?? "null"},`)
    metadataLines.push("  },")
  }

  return [
    "// ─────────────────────────────────────────────────────────────────────────────",
    "// AUTO-GENERATED by packages/contracts/scripts/generate-addresses.ts. DO NOT EDIT.",
    "// Source: foundry/deployments/<network>.json records with stage=verified,",
    "// validated against live chain state (INTEGRATION_AUDIT §3.3, rules 1-9) and",
    "// against the local Foundry artifacts (rule 10, §8.3).",
    "// ─────────────────────────────────────────────────────────────────────────────",
    "",
    'import type { ContractAddresses } from "./addresses"',
    "",
    "export const GENERATED_CONTRACT_ADDRESSES = {",
    ...addressLines,
    "} as const satisfies Record<number, ContractAddresses>",
    "",
    "/** verifiedAt: VerifyDeployment's block.timestamp (unix s). deployBlock: lower bound of the first deployment tx. */",
    "export const DEPLOYMENT_METADATA = {",
    ...metadataLines,
    "} as const",
    "",
  ].join("\n")
}

// ─── Orchestration ──────────────────────────────────────────────────────────

export interface RunOptions extends GenerateAddressesOptions {
  readonly outPath: string
  readonly check: boolean
  /** Injected for tests; defaults to fs.writeFileSync. */
  readonly writeFile?: (path: string, content: string) => void
}

export interface RunResult {
  readonly exitCode: number
  readonly errors: string[]
  readonly written: boolean
}

export async function runGenerateAddresses(options: RunOptions): Promise<RunResult> {
  const result = await validateRecords(options)
  if (!result.ok) return { exitCode: 1, errors: result.errors, written: false }

  const content = renderAddresses(result.deployments)

  if (options.check) {
    const current = existsSync(options.outPath) ? normalizeEol(readFileSync(options.outPath, "utf8")) : undefined
    if (current !== content) {
      return {
        exitCode: 1,
        errors: [`${options.outPath} is ${current === undefined ? "missing" : "stale"}; regenerate with generate:addresses`],
        written: false,
      }
    }
    return { exitCode: 0, errors: [], written: false }
  }

  ;(options.writeFile ?? writeFileSync)(options.outPath, content)
  return { exitCode: 0, errors: [], written: true }
}
