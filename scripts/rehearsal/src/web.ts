// Step 10: runs apps/web/rehearsal/*.rehearsal.test.ts (the web's own services
// and optimistic-listing action) against the rehearsal stack, and drives the
// 23503 scenario: the indexer is stopped, a fresh token is minted and listed
// on-chain, the suite gets not_indexed, and its retry hook asks this driver
// (marker file) to restart the indexer.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { account, RPC_URL } from "./chain"
import type { Ctx } from "./ctx"
import { scalar } from "./db"
import { REHEARSAL_CHAIN_ID } from "./guards"
import { CONFIRMATIONS, type IndexerProc } from "./indexer"
import { spawnBackground, waitFor } from "./proc"
import { MockNftAbi, must, now, router } from "./scenarios"

export async function webSuite(c: Ctx, idx: IndexerProc): Promise<void> {
  const webDir = path.join(c.repoRoot, "apps", "web")
  const markerDir = path.join(c.scratch, "web-markers")
  rmSync(markerDir, { recursive: true, force: true })
  mkdirSync(markerDir, { recursive: true })

  // 23503 setup: the indexer is stopped, so the nfts row cannot exist yet.
  await idx.stop()
  const tokenId = 500n
  const price = 1_234_567_890_123_456_789n
  const expiresAt = (await now(c)) + 3n * 86_400n
  await must(c, "23503: mint B#500 (indexer stopped)", "alice", { address: c.collections.B, abi: MockNftAbi, functionName: "mint", args: [account("alice").address, tokenId] })
  const listing = await must(c, "23503: list B#500 on-chain", "alice", router(c, "createListing", [c.collections.B, tokenId, price, expiresAt]))
  const nfts = await scalar(`select count(*) from public.nfts where chain_id = ${REHEARSAL_CHAIN_ID} and collection_address = '${c.collections.B.toLowerCase()}' and token_id = '500'`)
  c.log.eq("23503 precondition: no nfts row yet", nfts, "0")

  // apps/web runs the workspace-root vitest (it has no own devDependency).
  const vitest = path.join(c.repoRoot, "node_modules", "vitest", "vitest.mjs")
  const logPath = path.join(c.scratch, "web-rehearsal.log")
  const suite = spawnBackground(process.execPath, [vitest, "run", "--config", "vitest.rehearsal.config.ts", "--reporter", "verbose"], {
    cwd: webDir,
    logPath,
    env: {
      REHEARSAL_SUPABASE_URL: c.stack.apiUrl,
      REHEARSAL_SERVICE_ROLE_KEY: c.stack.serviceRoleKey,
      REHEARSAL_ANON_KEY: c.stack.anonKey,
      REHEARSAL_RPC_URL: RPC_URL,
      REHEARSAL_ROUTER: c.addresses.router,
      REHEARSAL_COLLECTION_A: c.collections.A,
      REHEARSAL_MARKER_DIR: markerDir,
      REHEARSAL_23503: JSON.stringify({ txHash: listing.transactionHash, collection: c.collections.B, tokenId: tokenId.toString(), price: price.toString(), expiresAt: expiresAt.toString(), seller: account("alice").address }),
    },
  })

  // Wait for the suite's retry hook to ask for the indexer, then start it.
  let exited = false
  void suite.exited.then(() => (exited = true))
  await waitFor("the web suite to ask for the indexer (or finish)", async () => existsSync(path.join(markerDir, "start-indexer")) || exited, { timeoutMs: 300_000, intervalMs: 200 })
  const asked = existsSync(path.join(markerDir, "start-indexer"))
  c.log.check("the web suite reached the 23503 retry and asked for the indexer", asked)
  if (asked) await restartIndexerPastListing({ rpc: (m, p) => c.chain.rpc(m, p), indexer: idx })
  const code = await suite.exited
  await suite.stop()
  const out = readFileSync(logPath, "utf8")
  const summary = out.match(/Tests\s+[^\n]*/)?.[0] ?? "(no summary)"
  c.log.check(`web rehearsal suite passes (${summary.trim()})`, code === 0 && /4 passed/.test(summary) && !/skipped/.test(summary), `exit ${code}; see ${logPath}`)
}

/**
 * Restarts the indexer and mines CONFIRMATIONS blocks. On an automine Anvil no
 * block follows the listing tx by itself, so without this the listing block
 * stays inside the confirmation window and is (correctly) never indexed; on a
 * live chain the next blocks arrive on their own.
 */
export async function restartIndexerPastListing(deps: { rpc: (method: string, params: unknown[]) => Promise<unknown>; indexer: Pick<IndexerProc, "start"> }): Promise<void> {
  deps.indexer.start()
  await deps.rpc("anvil_mine", [`0x${CONFIRMATIONS.toString(16)}`])
}
