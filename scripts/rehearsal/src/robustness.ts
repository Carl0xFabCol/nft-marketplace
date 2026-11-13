// Step 8: indexer robustness on a real chain.
//   (a) checkpoint hash == canonical block hash
//   (b) REORG_DETECTED on a real fork (evm_snapshot/evm_revert, and anvil_reorg), halt, operator rewind
//   (c) hard kill mid-range → restart → nothing lost or duplicated
//   (d) a failing write (privilege revoked) holds the cursor; the retry succeeds once re-granted
//   (e) CONFIRMATIONS lag
//   (f) activity.created_at == block timestamp (asserted by reconciliation, counted here)
//   (g) process-level replay over existing rows, and a full wipe + reindex: byte-identical derived state

import { parseEther, type Hex } from "viem"
import type { Ctx } from "./ctx"
import { psql, scalar } from "./db"
import { REHEARSAL_CHAIN_ID } from "./guards"
import { assertCursorHeld, CONFIRMATIONS, cursor, POLLING_INTERVAL_MS, syncTo, type IndexerProc } from "./indexer"
import { launch } from "./ctx"
import { sleep, waitFor } from "./proc"
import { MockNftAbi, must, now, router } from "./scenarios"
import { account } from "./chain"

const CHAIN = REHEARSAL_CHAIN_ID

async function activityCount(): Promise<number> {
  return Number(await scalar(`select count(*) from public.activity where chain_id = ${CHAIN}`))
}

async function mine(c: Ctx, n: number, timestampBump?: number): Promise<void> {
  if (timestampBump) await c.chain.rpc("evm_increaseTime", [timestampBump])
  await c.chain.rpc("anvil_mine", [`0x${n.toString(16)}`])
}

/** (a) */
export async function checkpointHash(c: Ctx, idx: IndexerProc): Promise<void> {
  await syncTo(c, idx)
  const cur = await cursor()
  const block = await c.chain.pub.getBlock({ blockNumber: cur.lastBlock! })
  c.log.eq("(a) indexer_state.last_block_hash == eth_getBlockByNumber(last_block).hash", cur.hash, block.hash)
}

/** (b) Fork with evm_snapshot/evm_revert; the orphaned range holds only empty blocks. */
export async function reorgDetection(c: Ctx, idx: IndexerProc): Promise<void> {
  await syncTo(c, idx)
  const forkPoint = await c.chain.pub.getBlockNumber()
  const snap = (await c.chain.rpc("evm_snapshot")) as Hex
  await mine(c, 8)
  const indexed = await syncTo(c, idx, forkPoint + 6n)
  const stored = await cursor()
  c.log.check("(b) the cursor passed the fork point before the reorg", indexed > forkPoint, `cursor ${indexed}, fork ${forkPoint}`)
  const rowsBefore = await activityCount()

  c.log.check("(b) evm_revert to the fork point", (await c.chain.rpc("evm_revert", [snap])) === true)
  await mine(c, 20, 37) // different timestamps → different hashes at the same heights
  const canonical = (await c.chain.pub.getBlock({ blockNumber: stored.lastBlock! })).hash
  c.log.check("(b) the stored cursor block is no longer canonical", canonical !== stored.hash, `${stored.hash} vs ${canonical}`)

  await waitFor("REORG_DETECTED in the indexer log", async () => idx.log().includes("REORG_DETECTED"), { timeoutMs: 30_000 })
  c.log.check("(b) the indexer halts loudly with REORG_DETECTED", true)
  c.log.check("(b) the cursor stays frozen while halted", await assertCursorHeld(stored.lastBlock, 5))
  c.log.eq("(b) nothing is written while halted", await activityCount(), rowsBefore)
  idx.assertAlive()

  // Operator procedure (docs/REORG_ROLLBACK_DESIGN.md §4): the orphaned range
  // (fork, cursor] holds no marketplace events, so only the cursor is rewound.
  const orphanedRows = await scalar(`select count(*) from public.activity where chain_id = ${CHAIN} and created_at > to_timestamp(${(await c.chain.pub.getBlock({ blockNumber: forkPoint })).timestamp})`)
  c.log.eq("(b) no rows were indexed from the orphaned blocks", orphanedRows, "0")
  await psql(`update public.indexer_state set last_block = ${forkPoint}, last_block_hash = null where chain_id = ${CHAIN};`)
  await syncTo(c, idx)
  const after = await cursor()
  const canonicalNow = (await c.chain.pub.getBlock({ blockNumber: after.lastBlock! })).hash
  c.log.eq("(b) after the operator rewind the indexer resumes on the canonical fork", after.hash, canonicalNow)
}

/** (b') anvil_reorg variant, if this Anvil supports it. */
export async function anvilReorg(c: Ctx, idx: IndexerProc): Promise<boolean> {
  await syncTo(c, idx)
  await mine(c, 6)
  const head = await c.chain.pub.getBlockNumber()
  await syncTo(c, idx, head)
  const stored = await cursor()
  const logLen = idx.log().length
  try {
    await c.chain.rpc("anvil_reorg", [5, []])
  } catch (e) {
    c.log.info(`anvil_reorg unavailable: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
  const canonical = (await c.chain.pub.getBlock({ blockNumber: stored.lastBlock! })).hash
  c.log.check("(b') anvil_reorg replaced the stored cursor block", canonical !== stored.hash)
  await mine(c, 1)
  await waitFor("a new REORG_DETECTED", async () => idx.log().slice(logLen).includes("REORG_DETECTED"), { timeoutMs: 30_000 })
  c.log.check("(b') anvil_reorg → REORG_DETECTED, halted", await assertCursorHeld(stored.lastBlock, 4))
  await psql(`update public.indexer_state set last_block = ${head - 5n}, last_block_hash = null where chain_id = ${CHAIN};`)
  await syncTo(c, idx)
  return true
}

/** Mints and lists on B to put many event-bearing blocks in front of the indexer. */
async function burstOfEvents(c: Ctx, firstId: bigint, n: number): Promise<void> {
  const exp = (await now(c)) + 7n * 86_400n
  for (let i = 0; i < n; i++) {
    const id = firstId + BigInt(i)
    await must(c, `burst: mint B#${id}`, "alice", { address: c.collections.B, abi: MockNftAbi, functionName: "mint", args: [account("alice").address, id] })
    await must(c, `burst: list B#${id}`, "alice", router(c, "createListing", [c.collections.B, id, parseEther("0.01") + id, exp]))
  }
}

/** (c) */
export async function killMidRange(c: Ctx, idx: IndexerProc): Promise<void> {
  await syncTo(c, idx)
  await idx.stop()
  const start = (await cursor()).lastBlock!
  await burstOfEvents(c, 200n, 20) // 40 blocks with events, BATCH_SIZE=5 → 8+ chunks
  const target = await c.chain.pub.getBlockNumber()
  await mine(c, CONFIRMATIONS)
  idx.start()
  const mid = await waitFor("the cursor to move into the range", async () => {
    const b = (await cursor()).lastBlock!
    return b > start && b < target - 5n ? b : undefined
  }, { timeoutMs: 60_000, intervalMs: 20 })
  await idx.kill()
  const atKill = (await cursor()).lastBlock!
  c.log.check("(c) killed mid-range (start < cursor < target)", atKill > start && atKill < target, `start ${start}, cursor ${atKill} (seen ${mid}), target ${target}`)
  idx.start()
  await syncTo(c, idx, target)
  const dups = await scalar(`select count(*) from (select tx_hash, log_index from public.activity group by 1,2 having count(*) > 1) d`)
  c.log.eq("(c) no duplicate (tx_hash, log_index) after the restart", dups, "0")
  const listed = await scalar(`select count(*) from public.listings where chain_id = ${CHAIN} and collection_address = '${c.collections.B.toLowerCase()}' and token_id::numeric between 200 and 219 and is_active`)
  c.log.eq("(c) all 20 burst listings present and active", listed, "20")
}

/** (d) */
export async function failingWrite(c: Ctx, idx: IndexerProc): Promise<void> {
  await must(c, "(d) mint B#220", "alice", { address: c.collections.B, abi: MockNftAbi, functionName: "mint", args: [account("alice").address, 220n] })
  await syncTo(c, idx)
  await psql("revoke insert on public.activity from service_role;")
  try {
    const r = await must(c, "(d) list B#220 while activity INSERT is revoked", "alice", router(c, "createListing", [c.collections.B, 220n, parseEther("0.5"), (await now(c)) + 86_400n]))
    const b = r.blockNumber
    await mine(c, CONFIRMATIONS + 3)
    await waitFor("the indexer to fail at the listing block", async () => idx.log().includes("Run stopped at a failed event"), { timeoutMs: 30_000 })
    c.log.check("(d) the cursor holds at B-1 while the write fails", await assertCursorHeld(b - 1n, 5), `B=${b}, cursor ${(await cursor()).lastBlock}`)
    const rows = await scalar(`select count(*) from public.activity where tx_hash = '${r.transactionHash.toLowerCase()}'`)
    c.log.eq("(d) no activity row was written for the failed event", rows, "0")
  } finally {
    await psql("grant insert on public.activity to service_role;")
  }
  await syncTo(c, idx)
  const once = await scalar(`select count(*) from public.activity where event = 'LISTING_CREATED' and token_id = '220' and collection_address = '${c.collections.B.toLowerCase()}'`)
  c.log.eq("(d) after re-granting, the retry wrote the row exactly once", once, "1")
}

/** (e) */
export async function confirmationLag(c: Ctx, idx: IndexerProc): Promise<void> {
  await syncTo(c, idx)
  await mine(c, 3)
  const head = await c.chain.pub.getBlockNumber()
  await waitFor("cursor == head - CONFIRMATIONS", async () => (await cursor()).lastBlock === head - BigInt(CONFIRMATIONS), { timeoutMs: 30_000 })
  await sleep(POLLING_INTERVAL_MS * 6)
  c.log.eq("(e) with no new blocks the cursor stays at head - CONFIRMATIONS", (await cursor()).lastBlock, head - BigInt(CONFIRMATIONS))
  await mine(c, CONFIRMATIONS)
  await waitFor("cursor reaches the old head", async () => (await cursor()).lastBlock === head, { timeoutMs: 30_000 })
  c.log.check("(e) mining CONFIRMATIONS more blocks releases exactly the old head", true)
}

/**
 * Canonical dump of the derived state: rows as jsonb minus surrogate keys and
 * wall-clock bookkeeping columns, sorted. Excluded columns (each written with
 * now() by the DB or the repositories, never from chain data):
 *   all tables: id, updated_at; nfts.last_synced; listings.created_at.
 */
export async function canonicalDump(): Promise<Record<string, string>> {
  const tables: Record<string, string> = {
    activity: "id",
    collections: "id,updated_at,created_at",
    listings: "id,updated_at,created_at",
    nfts: "id,last_synced",
    token_bids: "id,updated_at",
    collection_bids: "id,updated_at",
    collection_bid_fills: "bid_id",
    contract_indexer_state: "updated_at",
  }
  const out: Record<string, string> = {}
  for (const [t, drop] of Object.entries(tables)) {
    const minus = drop.split(",").map((col) => ` - '${col}'`).join("")
    out[t] = await scalar(`select coalesce(string_agg(j, E'\\n' order by j), '') from (select (to_jsonb(x)${minus})::text j from public.${t} x where chain_id = ${CHAIN}) s`)
  }
  return out
}

export function dumpDiff(a: Record<string, string>, b: Record<string, string>): string[] {
  const out: string[] = []
  for (const t of Object.keys(a)) {
    if (a[t] === b[t]) continue
    const la = new Set(a[t].split("\n"))
    const lb = new Set(b[t].split("\n"))
    const onlyA = [...la].filter((x) => !lb.has(x)).slice(0, 3)
    const onlyB = [...lb].filter((x) => !la.has(x)).slice(0, 3)
    out.push(`${t}: before-only ${JSON.stringify(onlyA)} / after-only ${JSON.stringify(onlyB)}`)
  }
  return out
}

/** (g) */
export async function replayFromScratch(c: Ctx, idx: IndexerProc): Promise<void> {
  const target = await syncTo(c, idx)
  await idx.stop()
  const before = await canonicalDump()

  // g1: lower the cursor over EXISTING rows (prepare-deployment --force seeds
  // the per-collection cursors it finds missing) and replay the whole range.
  await psql(`delete from public.contract_indexer_state where chain_id = ${CHAIN};`)
  const prep = await launch(c, "prepare-deployment", ["--network", "anvil", "--deployments-dir", c.deploymentsDir, "--force"], { allowFail: true })
  c.log.check("(g1) prepare-deployment --force lowers the cursor and seeds the collection cursors", prep.code === 0 && /4 collection cursor\(s\) seeded/.test(prep.stdout), prep.stdout + prep.stderr)
  const seeded = await scalar(`select string_agg(c.contract_address || ':' || (s.last_block = c.indexer_block - 1)::text, ',' order by 1) from public.contract_indexer_state s join public.collections c on c.contract_address = s.contract_address and c.chain_id = s.chain_id where s.chain_id = ${CHAIN}`)
  c.log.check("(g1) each collection cursor is seeded at indexer_block - 1", seeded.split(",").length === 4 && !seeded.includes(":false"), seeded)
  idx.start()
  await syncTo(c, idx, target)
  await idx.stop()
  const replayed = await canonicalDump()
  const d1 = dumpDiff(before, replayed)
  c.log.check("(g1) replaying the whole range over existing rows changes nothing (audit #11 on a real chain)", d1.length === 0, d1.join("\n"))

  // g2: wipe every derived table, reset the cursor, reindex from deployBlock - 1.
  await psql(`truncate public.activity, public.listings, public.nfts, public.token_bids, public.collection_bids, public.collection_bid_fills, public.collections, public.contract_indexer_state cascade;`)
  const prep2 = await launch(c, "prepare-deployment", ["--network", "anvil", "--deployments-dir", c.deploymentsDir, "--force"], { allowFail: true })
  c.log.check("(g2) prepare-deployment --force resets the cursor to deployBlock - 1", prep2.code === 0, prep2.stderr)
  idx.start()
  await syncTo(c, idx, target, 300_000)
  await idx.stop()
  const rebuilt = await canonicalDump()
  const d2 = dumpDiff(before, rebuilt)
  c.log.check("(g2) wipe + reindex from scratch rebuilds byte-identical derived state", d2.length === 0, d2.join("\n"))
  idx.start()
}
