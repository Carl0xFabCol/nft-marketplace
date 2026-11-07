// ═══════════════════════════════════════════════════════════════════════════════
// PREPARE DEPLOYMENT (INTEGRATION_AUDIT §8 step 8, DB-7)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Seeds the indexer cursors for a VERIFIED contract deployment so the indexer
// starts at the deployment block instead of an unbounded backfill:
//   * requires foundry/deployments/<network>.json to pass rules 1-4
//     (stage=verified, configured=true, chainId matches the network, addresses
//     present, distinct and checksummed) and its chainId to equal CHAIN_ID;
//   * upserts indexer_state (chain_id, last_block = deployBlock - 1,
//     last_block_hash = NULL);
//   * refuses to LOWER an existing last_block unless --force (raising it, e.g.
//     moving off a legacy deployment, is allowed; equal is a no-op);
//   * seeds contract_indexer_state for the chain's known collections at
//     indexer_block - 1, only where no row exists (never touches existing rows).
//
// Pure logic with injected I/O, so every refusal is testable offline.
// deployBlock comes from the record's `deployBlock` field when present
// (DeploymentConfig.sol does not write one today), otherwise from
// --deploy-block; if both are given they must agree.

import type { RecordFile, VerifiedDeployment } from "@marketplace/contracts/deployment-records"

export interface PrepareDeploymentOptions {
  network: string
  deployBlock?: number
  force: boolean
  dryRun: boolean
}

export interface PrepareDeploymentDeps {
  /** CHAIN_ID of this indexer process. */
  chainId: number
  /** Loads deployments/<network>.json, or null when the file does not exist. */
  readRecord(network: string): RecordFile | null
  /** Rules 1-4 of the address generator (checkRecordStatic). */
  checkRecord(file: RecordFile): { ok: true; deployment: VerifiedDeployment } | { ok: false; errors: string[] }
  indexerState: {
    findState(chainId: number): Promise<{ last_block: number | null } | null>
    setForDeployment(chainId: number, lastBlock: number): Promise<void>
  }
  contractState: {
    seedIfMissing(contractAddress: string, chainId: number, lastBlock: number): Promise<boolean>
  }
  collections: {
    getAll(chainId: number): Promise<{ contract_address: string; indexer_block: number | null }[]>
  }
  log(message: string): void
}

export interface PrepareDeploymentResult {
  deployment: VerifiedDeployment
  deployBlock: number
  previousLastBlock: number | null
  lastBlock: number
  indexerStateChanged: boolean
  seededCollections: string[]
  dryRun: boolean
}

export class PrepareDeploymentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PrepareDeploymentError"
  }
}

const isBlock = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0

export async function prepareDeployment(options: PrepareDeploymentOptions, deps: PrepareDeploymentDeps): Promise<PrepareDeploymentResult> {
  const file = deps.readRecord(options.network)
  if (!file) throw new PrepareDeploymentError(`no deployment record for network "${options.network}"`)

  const checked = deps.checkRecord(file)
  if (!checked.ok) {
    throw new PrepareDeploymentError(`deployment record ${file.fileName} is not a verified deployment:\n  ${checked.errors.join("\n  ")}`)
  }
  const deployment = checked.deployment

  if (deployment.chainId !== deps.chainId) {
    throw new PrepareDeploymentError(`record chainId ${deployment.chainId} does not match this indexer's CHAIN_ID ${deps.chainId}`)
  }

  const recordBlock = (file.data as Record<string, unknown>).deployBlock
  if (recordBlock !== undefined && !isBlock(recordBlock)) {
    throw new PrepareDeploymentError(`record deployBlock ${JSON.stringify(recordBlock)} is not a positive integer`)
  }
  if (options.deployBlock !== undefined && !isBlock(options.deployBlock)) {
    throw new PrepareDeploymentError(`--deploy-block ${options.deployBlock} is not a positive integer`)
  }
  if (isBlock(recordBlock) && options.deployBlock !== undefined && recordBlock !== options.deployBlock) {
    throw new PrepareDeploymentError(`--deploy-block ${options.deployBlock} disagrees with the record's deployBlock ${recordBlock}`)
  }
  const deployBlock = isBlock(recordBlock) ? recordBlock : options.deployBlock
  if (deployBlock === undefined) {
    throw new PrepareDeploymentError("the record has no deployBlock; pass --deploy-block <n> (the block of the first deployment transaction)")
  }

  const lastBlock = deployBlock - 1
  const existing = await deps.indexerState.findState(deps.chainId)
  const previous = existing?.last_block ?? null

  if (previous !== null && previous > lastBlock && !options.force) {
    throw new PrepareDeploymentError(
      `indexer_state.last_block for chain ${deps.chainId} is ${previous}; refusing to lower it to ${lastBlock} without --force`,
    )
  }

  const indexerStateChanged = previous !== lastBlock
  const prefix = options.dryRun ? "[dry-run] would " : ""
  if (indexerStateChanged) {
    deps.log(`${prefix}set indexer_state(chain ${deps.chainId}).last_block ${previous ?? "<none>"} -> ${lastBlock} (last_block_hash = NULL)`)
    if (!options.dryRun) await deps.indexerState.setForDeployment(deps.chainId, lastBlock)
  } else {
    deps.log(`indexer_state(chain ${deps.chainId}).last_block is already ${lastBlock}; unchanged`)
  }

  const seededCollections: string[] = []
  for (const c of await deps.collections.getAll(deps.chainId)) {
    const from = isBlock(c.indexer_block) ? c.indexer_block - 1 : lastBlock
    if (options.dryRun) {
      deps.log(`[dry-run] would seed contract_indexer_state(${c.contract_address}, chain ${deps.chainId}) at ${from} if missing`)
      continue
    }
    if (await deps.contractState.seedIfMissing(c.contract_address, deps.chainId, from)) {
      seededCollections.push(c.contract_address)
      deps.log(`seeded contract_indexer_state(${c.contract_address}, chain ${deps.chainId}) at ${from}`)
    }
  }

  return { deployment, deployBlock, previousLastBlock: previous, lastBlock, indexerStateChanged, seededCollections, dryRun: options.dryRun }
}

/** CLI arguments: --network <name> [--deploy-block <n>] [--force] [--dry-run] */
export function parseArgs(argv: string[]): PrepareDeploymentOptions {
  const options: PrepareDeploymentOptions = { network: "", force: false, dryRun: false }
  const args = argv.filter((a) => a !== "--")
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--network") options.network = args[++i] ?? ""
    else if (a === "--deploy-block") {
      const raw = args[++i]
      if (!raw || !/^[0-9]+$/.test(raw)) throw new PrepareDeploymentError(`--deploy-block needs a positive integer, got ${JSON.stringify(raw)}`)
      options.deployBlock = Number(raw)
    } else if (a === "--force") options.force = true
    else if (a === "--dry-run") options.dryRun = true
    else throw new PrepareDeploymentError(`unknown argument ${a}`)
  }
  if (!/^[a-z0-9-]+$/.test(options.network)) throw new PrepareDeploymentError("--network <name> is required (e.g. elysium)")
  return options
}
