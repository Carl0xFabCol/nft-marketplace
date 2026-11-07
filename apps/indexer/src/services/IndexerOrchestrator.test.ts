// Tests #9 and #10 (INTEGRATION_AUDIT §10; IDX-2, IDX-3) plus confirmation lag
// and retry. Every dependency is an in-memory fake; nothing touches a network.
import { describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({ env: { chainId: 99801 } }))

import { IndexerOrchestrator } from "./IndexerOrchestrator"
import { IndexerStateRepository } from "../persistence/IndexerStateRepository"
import type { ContractConfig, ContractFetchRequest, ParsedEvent } from "../types/indexer.types"
import { createRecordingSupabase } from "../test-utils/recordingSupabase"

const CHAIN = 99801
const COLLECTION = "0xd71331443968a9d958a5c5089cf74051f7b9d7e2"
const CORE: ContractConfig = { name: "core", address: "0x0000000000000000000000000000000000000c0e", abi: [], events: ["Sale"] }

function ev(block: bigint, logIndex = 0, contractName = "core", address: string = CORE.address): ParsedEvent {
  return {
    contractName,
    contractAddress: address as `0x${string}`,
    eventName: contractName === "nft" ? "Transfer" : "Sale",
    args: {},
    blockNumber: block,
    blockTimestamp: 1790000000,
    transactionHash: `0x${block.toString(16).padStart(64, "0")}` as `0x${string}`,
    logIndex,
    raw: {} as never,
  }
}

interface Setup {
  last: number
  head: bigint | bigint[]
  events: ParsedEvent[]
  failOn?: (e: ParsedEvent) => boolean
  confirmations?: number
  collections?: { contract_address: string; indexer_block: number }[]
  collectionState?: Record<string, number>
  batchSize?: number
  /** Any fetched chunk containing this block throws (RPC failure). */
  fetchFailsAt?: bigint
}

function setup(s: Setup) {
  const state = { last_block: s.last }
  const heads = Array.isArray(s.head) ? [...s.head] : [s.head]
  const provider = { getBlockNumber: vi.fn(async () => (heads.length > 1 ? heads.shift()! : heads[0])) }
  const providerPool = { executeWithFallback: vi.fn(async (op: (p: typeof provider) => Promise<bigint>) => op(provider)) }

  // One chunk [from, to]; honors each request's own fromBlock (per contract
  // address), like the real fetcher. calls[] records the order of fetches.
  const calls: string[] = []
  const fetchChunk = vi.fn(async (requests: ContractFetchRequest[], from: bigint, to: bigint) => {
    calls.push(`fetch ${from}-${to}`)
    if (s.fetchFailsAt !== undefined && from <= s.fetchFailsAt && s.fetchFailsAt <= to) throw new Error(`rpc failed for ${from}-${to}`)
    const fromByAddress = new Map(requests.map((r) => [r.contract.address.toLowerCase(), r.fromBlock]))
    return s.events.filter((e) => {
      const start = fromByAddress.get(e.contractAddress.toLowerCase())
      return start !== undefined && e.blockNumber >= start && e.blockNumber >= from && e.blockNumber <= to
    })
  })
  const eventFetcher = { fetchChunk }

  const dispatched: ParsedEvent[] = []
  const handlerRegistry = {
    dispatch: vi.fn(async (e: ParsedEvent) => {
      calls.push(`dispatch ${e.blockNumber}`)
      if (s.failOn?.(e)) throw new Error(`handler failed at ${e.blockNumber}`)
      dispatched.push(e)
    }),
  }

  const updateLastBlock = vi.fn(async (_chainId: number, block: number) => {
    calls.push(`checkpoint ${block}`)
    state.last_block = block
  })
  const stateRepo = { getState: vi.fn(async () => ({ chain_id: CHAIN, last_block: state.last_block })), updateLastBlock }

  const collectionState: Record<string, number> = { ...(s.collectionState ?? {}) }
  const contractStateRepo = {
    getContractState: vi.fn(async (addr: string) =>
      addr in collectionState ? { contract_address: addr, chain_id: CHAIN, last_block: collectionState[addr] } : null,
    ),
    upsertContractState: vi.fn(async (addr: string, _c: number, block: number) => {
      collectionState[addr] = block
    }),
  }
  const collectionsRepo = { getAll: vi.fn(async () => s.collections ?? []) }

  const orchestrator = new IndexerOrchestrator(
    providerPool as never,
    eventFetcher as never,
    handlerRegistry as never,
    stateRepo as never,
    contractStateRepo as never,
    collectionsRepo as never,
    [CORE],
    { pollingIntervalMs: 0, batchSize: s.batchSize ?? 1000, chainId: CHAIN, confirmations: s.confirmations ?? 0 },
  )
  return { orchestrator, state, collectionState, fetchChunk, calls, dispatched, updateLastBlock, contractStateRepo }
}

describe("IndexerOrchestrator cursor (IDX-2 / IDX-3)", () => {
  it("advances to the safe head when every event succeeds", async () => {
    const t = setup({ last: 100, head: 120n, events: [ev(105n), ev(110n)] })
    await t.orchestrator.runOnce()
    expect(t.dispatched.map((e) => e.blockNumber)).toEqual([105n, 110n])
    expect(t.state.last_block).toBe(120)
  })

  it("test #9: a failing handler holds the cursor before the failed block and runs no later event", async () => {
    const t = setup({
      last: 100,
      head: 120n,
      events: [ev(103n), ev(105n, 0), ev(105n, 1), ev(110n)],
      failOn: (e) => e.blockNumber === 105n && e.logIndex === 1,
    })
    await t.orchestrator.runOnce()
    expect(t.updateLastBlock).toHaveBeenCalledTimes(1)
    expect(t.updateLastBlock).toHaveBeenCalledWith(CHAIN, 104)
    expect(t.state.last_block).toBe(104)
    // Block 110 was never run, so the retry does not replay it a second time.
    expect(t.dispatched.map((e) => `${e.blockNumber}:${e.logIndex}`)).toEqual(["103:0", "105:0"])
  })

  it("test #9: a failure in the first unprocessed block writes nothing", async () => {
    const t = setup({ last: 100, head: 120n, events: [ev(101n), ev(110n)], failOn: (e) => e.blockNumber === 101n })
    await t.orchestrator.runOnce()
    expect(t.updateLastBlock).not.toHaveBeenCalled()
    expect(t.state.last_block).toBe(100)
  })

  it("retries the failed event on the next iteration", async () => {
    let failing = true
    const t = setup({ last: 100, head: 120n, events: [ev(103n), ev(105n), ev(110n)], failOn: (e) => failing && e.blockNumber === 105n })
    await t.orchestrator.runOnce()
    expect(t.state.last_block).toBe(104)

    failing = false
    await t.orchestrator.runOnce()
    expect(t.fetchChunk.mock.calls[1][0][0].fromBlock).toBe(105n)
    expect(t.state.last_block).toBe(120)
    expect(t.dispatched.map((e) => e.blockNumber)).toEqual([103n, 105n, 110n])
  })

  it("test #10: a provider reporting a lower head never rewinds the cursor", async () => {
    const t = setup({ last: 150, head: 140n, events: [] })
    await t.orchestrator.runOnce()
    expect(t.fetchChunk).not.toHaveBeenCalled()
    expect(t.updateLastBlock).not.toHaveBeenCalled()
    expect(t.state.last_block).toBe(150)
  })

  it("test #10: heads that go up and down only ever move the cursor forward", async () => {
    const t = setup({ last: 100, head: [130n, 120n, 140n], events: [] })
    const seen: number[] = []
    for (let i = 0; i < 3; i++) {
      await t.orchestrator.runOnce()
      seen.push(t.state.last_block)
    }
    expect(seen).toEqual([130, 130, 140])
  })

  it("applies the confirmation lag: head 200 with CONFIRMATIONS=12 indexes up to 188", async () => {
    const t = setup({ last: 100, head: 200n, confirmations: 12, events: [ev(150n), ev(190n)] })
    await t.orchestrator.runOnce()
    expect(t.fetchChunk).toHaveBeenCalledWith(expect.anything(), 101n, 188n)
    expect(t.dispatched.map((e) => e.blockNumber)).toEqual([150n])
    expect(t.state.last_block).toBe(188)
  })

  it("does nothing while the confirmed head is behind the cursor", async () => {
    const t = setup({ last: 100, head: 105n, confirmations: 12, events: [] })
    await t.orchestrator.runOnce()
    expect(t.fetchChunk).not.toHaveBeenCalled()
    expect(t.updateLastBlock).not.toHaveBeenCalled()
  })

  it("clamps collection cursors: held before a failure, never moved backwards", async () => {
    const ahead = "0x00000000000000000000000000000000000000aa"
    const fresh = "0x00000000000000000000000000000000000000bb"
    const t = setup({
      last: 100,
      head: 120n,
      collections: [
        { contract_address: COLLECTION, indexer_block: 1 },
        { contract_address: ahead, indexer_block: 1 },
        { contract_address: fresh, indexer_block: 115 },
      ],
      // COLLECTION is behind the failure; `ahead` is already past it.
      collectionState: { [COLLECTION]: 95, [ahead]: 110 },
      events: [ev(107n, 0, "nft", COLLECTION)],
      failOn: (e) => e.blockNumber === 107n,
    })
    await t.orchestrator.runOnce()
    expect(t.state.last_block).toBe(106)
    expect(t.collectionState[COLLECTION]).toBe(106)
    expect(t.collectionState[ahead]).toBe(110)
    // Registered at 115 (implicit cursor 114): a failure at 107 must not write 106 for it.
    expect(t.collectionState[fresh]).toBeUndefined()
    expect(t.contractStateRepo.upsertContractState).toHaveBeenCalledTimes(1)
  })
})

describe("IndexerStateRepository.updateLastBlock (IDX-3 DB-side guard)", () => {
  it("only matches rows whose last_block is lower or NULL", async () => {
    const sb = createRecordingSupabase()
    await new IndexerStateRepository(sb.client).updateLastBlock(CHAIN, 104)
    const [q] = sb.queries
    expect(q.table).toBe("indexer_state")
    expect(q.ops).toEqual([
      { method: "update", args: [{ last_block: 104 }] },
      { method: "eq", args: ["chain_id", CHAIN] },
      { method: "or", args: ["last_block.is.null,last_block.lt.104"] },
    ])
  })
})

describe("IndexerOrchestrator per-chunk streaming (IDX-8)", () => {
  // last 100, head 130, batchSize 10 -> chunks 101-110, 111-120, 121-130.
  it("checkpoints after every chunk", async () => {
    const t = setup({ last: 100, head: 130n, batchSize: 10, events: [ev(105n), ev(115n), ev(125n)] })
    await t.orchestrator.runOnce()
    expect(t.updateLastBlock.mock.calls.map((c) => c[1])).toEqual([110, 120, 130])
  })

  it("streams: a chunk is processed and checkpointed before the next one is fetched", async () => {
    const t = setup({ last: 100, head: 130n, batchSize: 10, events: [ev(105n), ev(115n)] })
    await t.orchestrator.runOnce()
    expect(t.calls).toEqual([
      "fetch 101-110",
      "dispatch 105",
      "checkpoint 110",
      "fetch 111-120",
      "dispatch 115",
      "checkpoint 120",
      "fetch 121-130",
      "checkpoint 130",
    ])
  })

  it("a handler failure in chunk 2 keeps chunk 1, holds at B-1 and never fetches chunk 3", async () => {
    const t = setup({ last: 100, head: 130n, batchSize: 10, events: [ev(105n), ev(113n), ev(117n), ev(125n)], failOn: (e) => e.blockNumber === 117n })
    await t.orchestrator.runOnce()
    expect(t.updateLastBlock.mock.calls.map((c) => c[1])).toEqual([110, 116])
    expect(t.fetchChunk).toHaveBeenCalledTimes(2)
    expect(t.dispatched.map((e) => e.blockNumber)).toEqual([105n, 113n])
  })

  it("a fetch failure in chunk 2 keeps chunk 1 and the next run resumes at chunk 2", async () => {
    const setupArgs: Parameters<typeof setup>[0] = { last: 100, head: 130n, batchSize: 10, events: [ev(105n), ev(115n), ev(125n)], fetchFailsAt: 115n }
    const t = setup(setupArgs)
    await expect(t.orchestrator.runOnce()).rejects.toThrow("rpc failed for 111-120")
    expect(t.state.last_block).toBe(110)

    setupArgs.fetchFailsAt = undefined
    await t.orchestrator.runOnce()
    const fetched = t.fetchChunk.mock.calls.map((c) => `${c[1]}-${c[2]}`)
    expect(fetched).toEqual(["101-110", "111-120", "111-120", "121-130"])
    expect(t.dispatched.map((e) => e.blockNumber)).toEqual([105n, 115n, 125n])
    expect(t.state.last_block).toBe(130)
  })

  it("stops between chunks when stop() is requested", async () => {
    const t = setup({ last: 100, head: 130n, batchSize: 10, events: [ev(105n)] })
    t.fetchChunk.mockImplementationOnce(async () => {
      t.orchestrator.stop()
      return [ev(105n)]
    })
    await t.orchestrator.runOnce()
    expect(t.fetchChunk).toHaveBeenCalledTimes(1)
    expect(t.state.last_block).toBe(110)
  })
})
