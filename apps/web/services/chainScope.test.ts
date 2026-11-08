// DB-9 guard: every web read of a market table must be scoped to ONE chain.
// A recording Supabase fake captures each `.from(table)` chain of calls; the
// test runs the real services and fails if any query on these tables lacks
// `chain_id = <page chain>`.
import { beforeEach, describe, expect, it, vi } from "vitest"

const SCOPED_TABLES = ["listings", "collections", "activity", "token_bids", "collection_bids", "nfts"]

interface Recorded {
  table: string
  calls: Array<[string, unknown[]]>
}

const recorded = vi.hoisted(() => [] as Recorded[])

function makeFakeSupabase() {
  return {
    from(table: string) {
      const rec: Recorded = { table, calls: [] }
      recorded.push(rec)
      const result = { data: [], error: null, count: 0 }
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
            return (...args: unknown[]) => {
              rec.calls.push([prop, args])
              if (prop === "single" || prop === "maybeSingle") return Promise.resolve({ data: null, error: null })
              return builder
            }
          },
        },
      )
      return builder
    },
    rpc: vi.fn(async () => ({ data: [], error: null })),
  }
}

const fake = vi.hoisted(() => ({ client: null as unknown }))
vi.mock("@/lib/supabase/client", () => ({
  get supabase() {
    return fake.client
  },
}))

import { NFTService } from "./nft.service"
import { UserService } from "./user.service"
import { CollectionService } from "./collections.service"
import type { SupabaseClient } from "@supabase/supabase-js"

const CHAIN = 99801
const USER = "0x00000000000000000000000000000000000000a1" as const
const COLLECTION = "0x00000000000000000000000000000000000000c1" as const

function chainScoped(rec: Recorded): boolean {
  return rec.calls.some(([m, args]) => m === "eq" && (args[0] === "chain_id" || args[0] === "collections.chain_id") && args[1] === CHAIN)
}

function assertAllScoped() {
  const market = recorded.filter((r) => SCOPED_TABLES.includes(r.table))
  expect(market.length).toBeGreaterThan(0)
  const unscoped = market.filter((r) => !chainScoped(r)).map((r) => `${r.table}: ${JSON.stringify(r.calls)}`)
  expect(unscoped).toEqual([])
}

beforeEach(() => {
  recorded.length = 0
  fake.client = makeFakeSupabase()
})

describe("chain scope of web reads (DB-9)", () => {
  it("NFT detail: nft, listing, token bids, collection and activity", async () => {
    await NFTService.getNFTDetail(COLLECTION, "1", CHAIN)
    expect(recorded.map((r) => r.table).sort()).toEqual(["activity", "collections", "listings", "nfts", "token_bids"])
    assertAllScoped()
  })

  it("collection page and owner inventory (listings, top bids, collections)", async () => {
    await NFTService.getCollectionNFTs(COLLECTION, { chainId: CHAIN, page: 1, limit: 24 })
    await NFTService.getNFTsByOwner(USER, { chainId: CHAIN, page: 1, limit: 24 })
    await NFTService.searchNFTs("abc", CHAIN)
    assertAllScoped()
  })

  it("user page: listings, bids, collections, activity, avatar options", async () => {
    const sb = fake.client as SupabaseClient
    await UserService.getUserData(sb, USER, CHAIN)
    await UserService.getUserCollectionBids(sb, USER, CHAIN)
    await UserService.getUserTokenBids(sb, USER, CHAIN)
    await UserService.getProfileAvatarOptions(sb, USER, CHAIN)
    await UserService.getUserActivityPaginated(sb, USER, { chainId: CHAIN, page: 2 })
    const tables = new Set(recorded.map((r) => r.table))
    for (const t of ["listings", "collections", "token_bids", "collection_bids", "activity", "nfts"]) expect(tables.has(t), t).toBe(true)
    assertAllScoped()
  })

  it("collections list, top by volume, top bids", async () => {
    const sb = fake.client as SupabaseClient
    await CollectionService.getCollections(sb, { chainId: CHAIN })
    await CollectionService.getTopCollectionsByVolume(sb, CHAIN)
    // getCollections returns [] here, so make the top-bids query run with one row.
    const spy = vi.spyOn(CollectionService, "getCollections").mockResolvedValueOnce({
      collections: [{ contract_address: COLLECTION } as never],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    })
    await CollectionService.getCollectionsWithTopBids(sb, { chainId: CHAIN })
    spy.mockRestore()
    expect(recorded.some((r) => r.table === "collection_bids")).toBe(true)
    assertAllScoped()
  })

  it("24h top collections: chain-scoped SALE activity, no chain-less RPC", async () => {
    const sb = fake.client as SupabaseClient & { rpc: ReturnType<typeof vi.fn> }
    await CollectionService.getTopCollectionsByVolume24h(sb, CHAIN, new Date("2026-11-08T12:00:00Z"))
    const activity = recorded.find((r) => r.table === "activity")!
    expect(activity.calls).toContainEqual(["eq", ["event", "SALE"]])
    expect(activity.calls).toContainEqual(["gte", ["created_at", "2026-11-07T12:00:00.000Z"]])
    expect(sb.rpc).not.toHaveBeenCalled()
    assertAllScoped()
  })

  it("rejects an unsupported chain instead of querying", async () => {
    const sb = fake.client as SupabaseClient
    await expect(UserService.getUserTokenBids(sb, USER, 1)).rejects.toThrow("Invalid chain id")
    await expect(CollectionService.getCollections(sb, { chainId: 1 })).rejects.toThrow("Invalid chain id")
    expect(recorded).toEqual([])
  })
})
