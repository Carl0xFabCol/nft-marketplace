#!/usr/bin/env npx tsx
/**
 * pnpm --filter @marketplace/indexer prepare-deployment -- --network <elysium|sepolia>
 *      [--deployments-dir <dir>] [--deploy-block <n>] [--force] [--dry-run]
 *
 * INTEGRATION_AUDIT §8 step 8. Seeds indexer_state at deployBlock - 1 and the
 * per-collection cursors for a VERIFIED deployment record
 * (packages/contracts/foundry/deployments/<network>.json). Uses the indexer's
 * own environment (CHAIN_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY); the
 * record's chainId must equal CHAIN_ID. Run it with the indexer STOPPED.
 * See src/deployment/prepareDeployment.ts for the rules.
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { checkRecordStatic } from "@marketplace/contracts/deployment-records"
import { env } from "../config/env"
import { parseArgs, prepareDeployment, PrepareDeploymentError } from "../deployment/prepareDeployment"
import { CollectionsRepository } from "../persistence/CollectionsRepository"
import { ContractIndexerStateRepository } from "../persistence/ContractIndexerStateRepository"
import { IndexerStateRepository } from "../persistence/IndexerStateRepository"
import { supabase } from "../supabase"

const DEPLOYMENTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/contracts/foundry/deployments")

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const deploymentsDir = options.deploymentsDir ? path.resolve(options.deploymentsDir) : DEPLOYMENTS_DIR
  const result = await prepareDeployment(options, {
    chainId: env.chainId,
    readRecord(network) {
      // latest.json and archive/ are never consumed, as in generate-addresses.
      const file = path.join(deploymentsDir, `${network}.json`)
      if (!existsSync(file)) return null
      return { fileName: `${network}.json`, data: JSON.parse(readFileSync(file, "utf8")) }
    },
    checkRecord: (file) => checkRecordStatic(file),
    indexerState: new IndexerStateRepository(supabase),
    contractState: new ContractIndexerStateRepository(supabase),
    collections: new CollectionsRepository(supabase),
    log: (m) => console.log(m),
  })
  console.log(
    `${result.dryRun ? "[dry-run] " : ""}prepare-deployment ${options.network} (chain ${result.deployment.chainId}): ` +
      `deployBlock ${result.deployBlock}, last_block ${result.previousLastBlock ?? "<none>"} -> ${result.lastBlock}, ` +
      `${result.seededCollections.length} collection cursor(s) seeded`,
  )
}

main().catch((error) => {
  console.error(error instanceof PrepareDeploymentError ? `✖ ${error.message}` : error)
  // No explicit exit call: after a Supabase round-trip, exiting while fetch
  // handles are still closing aborts Node on Windows with 0xC0000409
  // (libuv "!(handle->flags & UV_HANDLE_CLOSING)") instead of exit code 1
  // (Phase 5 finding F-3). Setting exitCode lets the loop drain and exit 1.
  process.exitCode = 1
})
