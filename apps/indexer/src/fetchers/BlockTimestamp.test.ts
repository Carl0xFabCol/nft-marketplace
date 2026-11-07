// Test #13 (INTEGRATION_AUDIT §10, IDX-9): a log without blockTimestamp must
// never be indexed with timestamp 0 (1970-01-01). The fetcher falls back to the
// block's timestamp from the RPC (cached per block) and fails loudly if that
// is unavailable too.
import { describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({ env: { batchSize: 1000, maxParallelRequests: 1 } }))

import { encodeEventTopics, erc721Abi, type Address } from "viem"
import { BatchEventFetcher } from "./BatchEventFetcher"
import type { ContractConfig, RawContractEvent } from "../types/indexer.types"

const NFT = "0xd71331443968a9d958a5c5089cf74051f7b9d7e2" as Address
const A = "0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294" as Address
const B = "0x373cdd612de9857dea8ca360efc302405dd82860" as Address
const contract: ContractConfig = { name: "nft", address: NFT, abi: erc721Abi, events: ["Transfer"] }

function transferLog(block: bigint, logIndex: number, blockTimestamp?: bigint): RawContractEvent {
  return {
    address: NFT,
    topics: encodeEventTopics({ abi: erc721Abi, eventName: "Transfer", args: { from: A, to: B, tokenId: BigInt(logIndex) } }) as `0x${string}`[],
    data: "0x",
    blockNumber: block,
    transactionHash: `0x${"ab".repeat(32)}`,
    logIndex,
    ...(blockTimestamp === undefined ? {} : { blockTimestamp }),
  }
}

function fetcherWith(logs: RawContractEvent[], getBlockTimestamp: (n: bigint) => Promise<bigint>) {
  const provider = { name: "fake", getContractEvents: vi.fn(async () => logs), getBlockTimestamp: vi.fn(getBlockTimestamp) }
  return { provider, fetcher: new BatchEventFetcher(provider as never, 1000, 1) }
}

describe("test #13: missing blockTimestamp (IDX-9)", () => {
  it("uses the log's own blockTimestamp when present, without an extra RPC call", async () => {
    const { provider, fetcher } = fetcherWith([transferLog(10n, 0, 1790000000n)], async () => 1n)
    const [event] = await fetcher.fetchEventsForContracts([{ contract, fromBlock: 10n }], 10n)
    expect(event.blockTimestamp).toBe(1790000000)
    expect(provider.getBlockTimestamp).not.toHaveBeenCalled()
  })

  it("falls back to getBlock(blockNumber).timestamp, once per distinct block", async () => {
    const times: Record<string, bigint> = { "10": 1790000010n, "11": 1790000011n }
    const logs = [transferLog(10n, 0), transferLog(10n, 1), transferLog(11n, 2), transferLog(11n, 3, 0n)]
    const { provider, fetcher } = fetcherWith(logs, async (n) => times[n.toString()])

    const events = await fetcher.fetchEventsForContracts([{ contract, fromBlock: 10n }], 11n)
    expect(events.map((e) => e.blockTimestamp)).toEqual([1790000010, 1790000010, 1790000011, 1790000011])
    expect(provider.getBlockTimestamp).toHaveBeenCalledTimes(2)
  })

  it("throws (never writes 1970) when the block timestamp cannot be fetched", async () => {
    const { fetcher } = fetcherWith([transferLog(10n, 0)], async () => {
      throw new Error("rpc down")
    })
    await expect(fetcher.fetchEventsForContracts([{ contract, fromBlock: 10n }], 10n)).rejects.toThrow("rpc down")
  })

  it("throws when the RPC reports timestamp 0", async () => {
    const { fetcher } = fetcherWith([transferLog(10n, 0)], async () => 0n)
    await expect(fetcher.fetchEventsForContracts([{ contract, fromBlock: 10n }], 10n)).rejects.toThrow(/refusing to index it with timestamp 0/)
  })
})
