import { describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({
  env: { batchSize: 1000, maxParallelRequests: 1 },
}))

import type { Address } from "viem"
import { BatchEventFetcher } from "./BatchEventFetcher"
import type { ContractConfig } from "../types/indexer.types"

const collectionAddress = "0xd71331443968a9d958a5c5089cf74051f7b9d7e2" as Address
const coreAddress = "0x8dDbd93EaD1766a1Fe98DE55D68a7B8529B5f079" as Address

function contract(name: string, address: Address): ContractConfig {
  return { name, address, abi: [], events: ["Transfer"] }
}

describe("BatchEventFetcher.fetchEventsForContracts", () => {
  it("skips contracts whose fromBlock is after the chunk end instead of requesting an inverted range", async () => {
    const getContractEvents = vi.fn(async ({ address, fromBlock, toBlock }: { address: Address; fromBlock: bigint; toBlock: bigint }) => {
      if (fromBlock > toBlock) {
        throw new Error("invalid block range params")
      }
      if (address === coreAddress) {
        throw new Error("core contract should have been skipped")
      }
      return []
    })

    const fetcher = new BatchEventFetcher({ name: "stub", getContractEvents } as never, 1000, 2)

    const events = await fetcher.fetchEventsForContracts(
      [
        // Collection starts earlier, so it defines the chunk range...
        { contract: contract("nft", collectionAddress), fromBlock: 100n },
        // ...but the static contract's cursor is already ahead of this chunk.
        { contract: contract("core", coreAddress), fromBlock: 200n },
      ],
      150n,
    )

    expect(events).toEqual([])
    expect(getContractEvents).toHaveBeenCalledTimes(1)
    expect(getContractEvents).toHaveBeenCalledWith(
      expect.objectContaining({ address: collectionAddress, fromBlock: 100n, toBlock: 150n }),
    )
  })
})

describe("BatchEventFetcher.fetchChunk (IDX-8)", () => {
  it("fetches exactly one range, clamps each contract to its own fromBlock and returns events sorted", async () => {
    const ev = (block: bigint, logIndex: number) => ({ blockNumber: block, logIndex })
    const getContractEvents = vi.fn(async () => [])
    const fetcher = new BatchEventFetcher({ name: "stub", getContractEvents } as never, 10, 2)
    // Reach into the decode step: stub fetchContractEvents to return unsorted events per contract.
    const perContract = vi
      .spyOn(fetcher as never as { fetchContractEvents: (...a: unknown[]) => Promise<unknown[]> }, "fetchContractEvents")
      .mockImplementation(async (c: unknown) => ((c as ContractConfig).name === "nft" ? [ev(150n, 3), ev(120n, 0)] : [ev(150n, 1)]))

    const events = await fetcher.fetchChunk(
      [
        { contract: contract("nft", collectionAddress), fromBlock: 100n },
        { contract: contract("core", coreAddress), fromBlock: 140n },
      ],
      101n,
      5000n,
    )

    // One call per contract for the whole [101, 5000] range: no further chunking despite batchSize 10.
    expect(perContract.mock.calls.map((c) => [(c[0] as ContractConfig).name, c[1], c[2]])).toEqual([
      ["nft", 101n, 5000n],
      ["core", 140n, 5000n],
    ])
    expect(events.map((e) => `${e.blockNumber}:${e.logIndex}`)).toEqual(["120:0", "150:1", "150:3"])
  })
})
