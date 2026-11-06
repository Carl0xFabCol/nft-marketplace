import { beforeEach, describe, expect, it, vi } from "vitest"

const COLLECTION = "0x0000000000000000000000000000000000000010"
const ELYSIUM = 99801
const SEPOLIA = 11155111

type QueryState = {
  table: string
  filters: Array<[string, unknown]>
  countQuery: boolean
  range?: [number, number]
}

const mocks = vi.hoisted(() => {
  const queries: QueryState[] = []

  function rowsFor(table: string) {
    if (table === "nfts") {
      return [
        {
          id: "nft-1",
          token_id: "1",
          collection_address: "0x0000000000000000000000000000000000000010",
          owner_wallet: "0x0000000000000000000000000000000000000002",
          chain_id: 99801,
        },
      ]
    }
    return []
  }

  function makeBuilder(table: string) {
    const state: QueryState = { table, filters: [], countQuery: false }
    queries.push(state)

    const builder: Record<string, unknown> = {}
    const chainable = () => builder

    builder.select = vi.fn((_columns: string, options?: { count?: string; head?: boolean }) => {
      state.countQuery = Boolean(options?.count && options?.head)
      return builder
    })
    builder.eq = vi.fn((column: string, value: unknown) => {
      state.filters.push([column, value])
      return builder
    })
    builder.neq = vi.fn((column: string, value: unknown) => {
      state.filters.push([column, value])
      return builder
    })
    builder.in = vi.fn((column: string, value: unknown) => {
      state.filters.push([column, value])
      return builder
    })
    builder.order = vi.fn(chainable)
    builder.gt = vi.fn(chainable)
    builder.limit = vi.fn(chainable)
    builder.range = vi.fn((from: number, to: number) => {
      state.range = [from, to]
      return Promise.resolve({ data: rowsFor(table), error: null })
    })
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      const result = state.countQuery ? { count: rowsFor(table).length, error: null } : { data: rowsFor(table), error: null }
      return Promise.resolve(result).then(resolve, reject)
    }

    return builder
  }

  return { queries, makeBuilder }
})

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => mocks.makeBuilder(table),
  },
}))

import { NFTService } from "./nft.service"

function chainFilters(table: string) {
  return mocks.queries.filter((query) => query.table === table).flatMap((query) => query.filters.filter(([column]) => column === "chain_id").map(([, value]) => value))
}

describe("NFTService chain-scoped pagination", () => {
  beforeEach(() => {
    mocks.queries.length = 0
  })

  it("uses the page chain for NFT/listing reads and the page number for pagination", async () => {
    await NFTService.getCollectionNFTs(COLLECTION, { chainId: ELYSIUM, page: 2, limit: 24 })

    expect(chainFilters("nfts")).toEqual([ELYSIUM, ELYSIUM])
    expect(chainFilters("listings")).toEqual([ELYSIUM])

    const dataQuery = mocks.queries.find((query) => query.table === "nfts" && query.range)
    expect(dataQuery?.range).toEqual([24, 47])
  })

  it("does not reuse an Elysium listing cache/query when the page chain is Sepolia", async () => {
    await NFTService.getCollectionNFTs(COLLECTION, { chainId: SEPOLIA, page: 1, limit: 24 })

    expect(chainFilters("nfts")).toEqual([SEPOLIA, SEPOLIA])
    expect(chainFilters("listings")).toEqual([SEPOLIA])
    expect(chainFilters("nfts")).not.toContain(ELYSIUM)
  })

  it("fails closed when the page chain is missing or invalid", async () => {
    await expect(NFTService.getCollectionNFTs(COLLECTION, { chainId: undefined as unknown as number })).rejects.toThrow("Invalid chain id")
    await expect(NFTService.getCollectionNFTs(COLLECTION, { chainId: 1 })).rejects.toThrow("Invalid chain id")

    expect(mocks.queries).toHaveLength(0)
  })
})
