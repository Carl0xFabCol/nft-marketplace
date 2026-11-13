// Phase 5 end-to-end rehearsal (audit test #21). See docs/PHASE5_REHEARSAL.md.
//
//   pnpm --filter @marketplace/rehearsal anvil-e2e -- --scratch <dir outside the repo> [--keep] [--reuse-db]
//
// Local only: Anvil on 127.0.0.1 with its published test keys, a local Supabase
// stack, no .env, no remote RPC or database. Processes (Anvil, indexer,
// metadata server) are always stopped at the end; the Supabase stack too,
// unless --keep. --reuse-db wipes the rows of an already running stack instead
// of rebuilding it (development iterations only; recorded runs never use it).

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { startAnvil, type Chain } from "./chain"
import { type Ctx } from "./ctx"
import { adminClient, psql, scalar, setupLocalDb, stackEnv, stopLocalDb, type DbPaths } from "./db"
import { REHEARSAL_CHAIN_ID, repoRootFrom } from "./guards"
import { IndexerProc, syncTo } from "./indexer"
import { RunLog } from "./log"
import { startMetadataServer } from "./metadata"
import { abisAndValidate, deployCollections, deployStack, generateAddresses, prepareDeployment } from "./pipeline"
import { formatReport, reconcile, type ReconcileReport } from "./reconcile"
import { marketScenarios, mintInventory, withdrawals, type Inventory } from "./scenarios"
import { slippageCases, slippageProof } from "./slippage"
import { webSuite } from "./web"
import { anvilReorg, checkpointHash, confirmationLag, failingWrite, killMidRange, reorgDetection, replayFromScratch } from "./robustness"

export const REPO_ROOT = repoRootFrom(__dirname)

interface Args {
  scratch: string
  keep: boolean
  reuseDb: boolean
}

function parseArgs(argv: string[]): Args {
  const a = argv.filter((x) => x !== "--")
  let scratch = ""
  let keep = false
  let reuseDb = false
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--scratch") scratch = a[++i] ?? ""
    else if (a[i] === "--keep") keep = true
    else if (a[i] === "--reuse-db") reuseDb = true
    else throw new Error(`unknown argument ${a[i]}`)
  }
  if (!scratch) throw new Error("--scratch <dir> is required (a directory OUTSIDE the repository)")
  const abs = path.resolve(scratch)
  if ((abs + path.sep).toLowerCase().startsWith((REPO_ROOT + path.sep).toLowerCase())) {
    throw new Error(`--scratch ${abs} is inside the repository; use a directory outside it`)
  }
  return { scratch: abs, keep, reuseDb }
}

/** Every derived/market table, emptied for --reuse-db (local stack only). */
export const MARKET_TABLES = ["activity", "listings", "nfts", "token_bids", "collection_bids", "collection_bid_fills", "collections", "contract_indexer_state", "indexer_state"]

export async function reconcileStep(ctx: Ctx, label: string, file: string): Promise<ReconcileReport> {
  const r = await reconcile({ chainId: REHEARSAL_CHAIN_ID, pub: ctx.chain.pub, db: ctx.admin, core: ctx.addresses.core, bids: ctx.addresses.bids, router: ctx.addresses.router, fromBlock: ctx.deployBlock })
  const text = formatReport(r)
  writeFileSync(path.join(ctx.scratch, file), text)
  console.log(text.split("\n").map((l) => `    ${l}`).join("\n"))
  ctx.log.check(`${label}: 0 mismatches at block ${r.atBlock}`, r.mismatches.length === 0, `${r.mismatches.length} mismatch(es); see ${file}`)
  return r
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  // The Supabase project dir lives NEXT TO the scratch dir, so wiping scratch
  // never deletes the config of a running stack.
  const supabaseWorkdir = path.join(path.dirname(args.scratch), `${path.basename(args.scratch)}-supabase`)
  rmSync(args.scratch, { recursive: true, force: true })
  mkdirSync(args.scratch, { recursive: true })
  // dotenv/config reads this instead of any .env (launch.ts requires it).
  writeFileSync(path.join(args.scratch, "empty-dotenv"), "")
  const log = new RunLog(path.join(args.scratch, "run.log.jsonl"))
  const dbPaths: DbPaths = { repoRoot: REPO_ROOT, workdir: supabaseWorkdir }
  const ctx = { repoRoot: REPO_ROOT, scratch: args.scratch, log, dbPaths } as Ctx
  const cleanups: (() => Promise<unknown>)[] = []

  let failed: unknown
  try {
    await log.step("1. local DB: baseline + migrations + fingerprint", async () => {
      if (args.reuseDb) {
        log.info("--reuse-db: wiping the market tables of the running local stack (development only)")
        ctx.stack = await stackEnv(dbPaths)
        await psql(`truncate ${MARKET_TABLES.map((t) => `public.${t}`).join(", ")} cascade;`)
        return
      }
      const r = await setupLocalDb(dbPaths, (m) => log.info(m))
      ctx.stack = r.env
      log.check("catalog fingerprint == catalog_fingerprint.after_phase3b.txt", r.fingerprint === "FINGERPRINT-SAME")
      log.check("17 migrations applied (090000-091600)", r.migrations.length === 17, String(r.migrations.length))
    })
    ctx.admin = adminClient(ctx.stack)

    await log.step("2. chain: Anvil + Deploy/Configure/Verify (real scripts) + collections", async () => {
      const meta = await startMetadataServer()
      cleanups.push(meta.close)
      const chain: Chain = await startAnvil(path.join(args.scratch, "anvil.log"))
      cleanups.push(() => chain.anvil.stop())
      ctx.chain = chain
      const d = await deployStack(REPO_ROOT, args.scratch, chain, log)
      ctx.foundryDir = d.foundryDir
      ctx.addresses = d.addresses
      ctx.deployBlock = d.deployBlock
      ctx.deploymentsDir = path.join(d.foundryDir, "deployments")
      ctx.collections = await deployCollections(d.foundryDir, chain, d.addresses, log, path.join(args.scratch, "anvil.log"))
      log.info("stack", { ...ctx.addresses, deployBlock: ctx.deployBlock, ...ctx.collections })
    })

    await log.step("3. generate addresses (rules 1-10) + ABIs + validate:integration", async () => {
      ctx.addressesFile = path.join(args.scratch, "addresses.generated.ts")
      await generateAddresses(ctx)
      await abisAndValidate(ctx)
    })

    await log.step("4. prepare-deployment (success path, idempotence, refusal, --force)", () => prepareDeployment(ctx))

    const idx = new IndexerProc(ctx)
    cleanups.push(() => idx.stop())
    await log.step("5. real indexer process (launch.ts, CONFIRMATIONS=2, BATCH_SIZE=5)", async () => {
      idx.start()
      const at = await syncTo(ctx, idx)
      const l = idx.log()
      log.check("indexer verified its provider's eth_chainId (no mismatch, no exclusion)", !/Provider chain mismatch|Could not verify provider chain/.test(l))
      const ownership = await scalar(`select count(*) from public.activity where chain_id = ${REHEARSAL_CHAIN_ID} and event = 'OWNERSHIP_TRANSFERRED'`)
      log.check("Core's constructor OwnershipTransferred (in deployBlock) was indexed: deployBlock skipped nothing", Number(ownership) >= 1, ownership)
      log.info(`indexer caught up to block ${at}`)
    })

    let inv: Inventory | undefined
    await log.step("6. on-chain scenarios (list/update/cancel/buy/batch/bids/admin/pause)", async () => {
      inv = await mintInventory(ctx)
      await marketScenarios(ctx, inv)
      await syncTo(ctx, idx)
    })

    await log.step("7. slippage proof (web quote, 0 bps) + withdrawals", async () => {
      await slippageProof(ctx, inv!)
      await withdrawals(ctx, ["alice", "dave", "fees", "royalty", "carol", "bob"])
      await syncTo(ctx, idx)
      for (const k of slippageCases) {
        log.info(`slippage case: ${k.name}: price ${k.price} x ${k.tokens}, fee ${k.fee}, royalty ${k.royalty} (${k.sources}), proceeds ${k.proceeds}`)
      }
    })

    await log.step("9a. reconciliation #1 (DB == chain, exactly)", async () => {
      await reconcileStep(ctx, "reconciliation #1", "reconcile-1.txt")
    })

    await log.step("8a. checkpoint stores the canonical block hash", () => checkpointHash(ctx, idx))
    await log.step("8b. real reorg → REORG_DETECTED, halt, operator rewind", async () => {
      await reorgDetection(ctx, idx)
      if (!(await anvilReorg(ctx, idx))) log.info("(b') anvil_reorg not available in this Anvil; the evm_snapshot/evm_revert fork above is the reorg test")
    })
    await log.step("8c. hard kill mid-range, restart: nothing lost or duplicated", () => killMidRange(ctx, idx))
    await log.step("8d. failing write (privilege revoked) holds the cursor; retry succeeds", () => failingWrite(ctx, idx))
    await log.step("8e. CONFIRMATIONS lag", () => confirmationLag(ctx, idx))
    await log.step("8g. replay over existing rows + wipe and reindex from scratch", () => replayFromScratch(ctx, idx))

    await log.step("10. web data layer (services, wei as text, 23503 retry) against the rehearsal DB", () => webSuite(ctx, idx))

    await log.step("9b. final reconciliation (after reorgs, kill, failure, replay)", async () => {
      await syncTo(ctx, idx)
      const r = await reconcileStep(ctx, "final reconciliation", "reconcile-final.txt")
      const ts = r.mismatches.filter((m) => m.field.startsWith("created_at")).length
      log.eq("8f. every activity.created_at equals its block timestamp", ts, 0)
      log.info(`8f. activity rows checked against block timestamps: ${r.counts.indexedLogs}`)
    })
  } catch (e) {
    failed = e
    console.error(`\n✖ ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  } finally {
    // Processes are always stopped; --keep only leaves the DB stack up.
    for (const c of cleanups.reverse()) await c().catch(() => undefined)
    if (!args.keep && !args.reuseDb) await stopLocalDb(dbPaths)
    console.log(log.summary())
    writeFileSync(path.join(args.scratch, "summary.txt"), log.summary())
  }
  if (failed) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
