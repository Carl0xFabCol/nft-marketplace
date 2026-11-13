// The REAL indexer process (apps/indexer/src/index.ts through launch.ts),
// started and stopped by the rehearsal, plus cursor helpers.

import { readFileSync } from "node:fs"
import path from "node:path"
import { launchBackground, type Ctx } from "./ctx"
import { scalar } from "./db"
import { REHEARSAL_CHAIN_ID } from "./guards"
import { sleep, waitFor, type Background } from "./proc"

/** Small lag and chunks, so lag and multi-chunk checkpointing are exercised. */
export const CONFIRMATIONS = 2
export const BATCH_SIZE = 5
export const POLLING_INTERVAL_MS = 300

export class IndexerProc {
  private proc: Background | undefined
  private starts = 0
  readonly logPath: string

  constructor(private readonly c: Ctx) {
    this.logPath = path.join(c.scratch, "indexer.log")
  }

  get running(): boolean {
    return !!this.proc && this.proc.child.exitCode === null
  }

  start(extra: Record<string, string> = {}): void {
    if (this.running) return
    this.starts++
    this.c.log.info(`starting the indexer process (#${this.starts})`)
    this.proc = launchBackground(this.c, "indexer", [], this.logPath, {
      CONFIRMATIONS: String(CONFIRMATIONS),
      BATCH_SIZE: String(BATCH_SIZE),
      POLLING_INTERVAL_MS: String(POLLING_INTERVAL_MS),
      ...extra,
    })
  }

  /** Graceful stop (SIGTERM → orchestrator.stop()). */
  async stop(): Promise<void> {
    if (!this.proc) return
    await this.proc.stop("SIGTERM")
    this.proc = undefined
  }

  /** Hard kill mid-run (no graceful shutdown). */
  async kill(): Promise<void> {
    if (!this.proc) return
    this.proc.child.kill("SIGKILL")
    await this.proc.exited
    await this.proc.stop()
    this.proc = undefined
  }

  log(): string {
    try {
      return readFileSync(this.logPath, "utf8")
    } catch {
      return ""
    }
  }

  /** Fails fast if the process died. */
  assertAlive(): void {
    if (this.proc && this.proc.child.exitCode !== null) {
      throw new Error(`indexer exited with code ${this.proc.child.exitCode}; see ${this.logPath}\n${this.log().split(/\r?\n/).slice(-25).join("\n")}`)
    }
  }
}

export async function cursor(): Promise<{ lastBlock: bigint | null; hash: string | null }> {
  const raw = await scalar(`select coalesce(last_block::text,'') || '|' || coalesce(last_block_hash,'') from public.indexer_state where chain_id = ${REHEARSAL_CHAIN_ID}`)
  const [b, h] = raw.split("|")
  return { lastBlock: b ? BigInt(b) : null, hash: h || null }
}

/**
 * Mines enough blocks to cover the confirmation lag and waits until the global
 * cursor reaches `target` (default: the head before mining).
 */
export async function syncTo(c: Ctx, idx: IndexerProc, target?: bigint, timeoutMs = 120_000): Promise<bigint> {
  const goal = target ?? (await c.chain.pub.getBlockNumber())
  const head = await c.chain.pub.getBlockNumber()
  if (head < goal + BigInt(CONFIRMATIONS)) await c.chain.rpc("anvil_mine", [`0x${(goal + BigInt(CONFIRMATIONS) - head).toString(16)}`])
  return waitFor(
    `indexer cursor >= ${goal}`,
    async () => {
      idx.assertAlive()
      const cur = await cursor()
      return cur.lastBlock !== null && cur.lastBlock >= goal ? cur.lastBlock : undefined
    },
    { timeoutMs, intervalMs: 200 },
  )
}

/** The cursor must stay at `expected` across `polls` indexer polling intervals. */
export async function assertCursorHeld(expected: bigint | null, polls = 4): Promise<boolean> {
  for (let i = 0; i < polls; i++) {
    await sleep(POLLING_INTERVAL_MS * 2)
    if ((await cursor()).lastBlock !== expected) return false
  }
  return true
}
