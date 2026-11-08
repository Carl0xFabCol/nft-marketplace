// services/collections.service.ts
import { SupabaseClient } from "@supabase/supabase-js"
import { COLLECTION_COLUMNS, type CollectionBidRowText, type CollectionRowText } from "@/lib/supabase/columns"
import { Address } from "viem"
import { Collection } from "@/types/user.types"
import { clampInt, sanitizePostgrestSearch } from "@/lib/validation"
import { toWei } from "@/lib/wei"

export type { Collection }

// ─── helpers ────────────────────────────────────────────────────────────────

import { SUPPORTED_CHAIN_IDS, ZERO_ADDRESS } from "@marketplace/shared"
const ZERO = ZERO_ADDRESS

function requireSupportedChain(chainId: number): number {
  if (!SUPPORTED_CHAIN_IDS.includes(chainId as (typeof SUPPORTED_CHAIN_IDS)[number])) throw new Error("Invalid chain id")
  return chainId
}

type CollectionRow = CollectionRowText
type CollectionRowWithCount = CollectionRow & { nfts?: Array<{ count: number }> }
type CollectionBidRow = Pick<CollectionBidRowText, "collection_address" | "price" | "bidder_wallet" | "created_at">
type Sale24hRow = { collection_address: string | null; price: string | null }

/** Upper bound of SALE rows read for the 24h ranking (one query, no pagination). */
const SALES_24H_ROW_CAP = 10_000

/** Sum wei per collection (bigint), rank by volume desc, keep the top `limit`. */
export function aggregateSales24h(rows: Sale24hRow[], limit = 5): Array<{ collection_address: string; volume_wei: string; sales: number }> {
  const acc = new Map<string, { volume: bigint; sales: number }>()
  for (const row of rows) {
    const wei = toWei(row.price)
    if (!row.collection_address || wei === null) continue
    const key = row.collection_address.toLowerCase()
    const cur = acc.get(key) ?? { volume: BigInt(0), sales: 0 }
    cur.volume += wei
    cur.sales += 1
    acc.set(key, cur)
  }
  return [...acc.entries()]
    .sort(([ka, a], [kb, b]) => (a.volume === b.volume ? ka.localeCompare(kb) : a.volume > b.volume ? -1 : 1))
    .slice(0, limit)
    .map(([collection_address, v]) => ({ collection_address, volume_wei: v.volume.toString(), sales: v.sales }))
}

export type CollectionWith24hStats = Collection & {
  /** wei, exact decimal-integer text */
  volume_24h: string
  sales_24h: number
  rank: number
}

function toCollection({ nfts, ...row }: CollectionRowWithCount): Collection {
  return {
    ...row,
    contract_address: row.contract_address as Address,
    nft_count: nfts?.[0]?.count ?? 0,
  }
}

// ─── CollectionService ──────────────────────────────────────────────────────

export class CollectionService {
  /**
   * Collections with pagination.
   * Resolves the nft_count N+1 with an aggregated COUNT in a single query.
   */
  static async getCollections(
    supabase: SupabaseClient,
    options: {
      chainId: number
      page?: number
      limit?: number
      sortBy?: "volume" | "sales" | "name" | "created"
      sortDir?: "asc" | "desc"
      verified?: boolean
      search?: string
    },
  ): Promise<{ collections: Collection[]; total: number; page: number; limit: number; totalPages: number }> {
    const { sortBy = "volume", sortDir = "desc", verified, search } = options
    const chainId = requireSupportedChain(options.chainId)
    const page = clampInt(options?.page, 1, 1, 100_000)
    const limit = clampInt(options?.limit, 20, 1, 100)

    const from = (page - 1) * limit
    const to = from + limit - 1

    // Single query — nft_count comes from Supabase's aggregate count.
    let query = supabase.from("collections").select(`${COLLECTION_COLUMNS}, nfts(count)`, { count: "exact" }).eq("chain_id", chainId).neq("nfts.owner_wallet", ZERO)

    if (verified !== undefined) query = query.eq("is_verified", verified)

    // Sanitise before interpolating into PostgREST's filter grammar.
    const safeSearch = search ? sanitizePostgrestSearch(search) : ""
    if (safeSearch) {
      query = query.or(`name.ilike.%${safeSearch}%,symbol.ilike.%${safeSearch}%,contract_address.ilike.%${safeSearch}%`)
    }

    const sortColumn = sortBy === "volume" ? "total_volume" : sortBy === "sales" ? "total_sales" : sortBy === "name" ? "name" : "created_at"

    query = query.order(sortColumn, {
      ascending: sortDir === "asc",
      nullsFirst: false,
    })

    const { data, error, count } = await query.range(from, to)
    if (error) throw error

    return {
      collections: ((data ?? []) as CollectionRowWithCount[]).map(toCollection),
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    }
  }

  /**
   * Top N collections by volume.
   */
  static async getTopCollectionsByVolume(supabase: SupabaseClient, chainId: number, limit = 10): Promise<Collection[]> {
    chainId = requireSupportedChain(chainId)
    const safeLimit = clampInt(limit, 10, 1, 100)

    const { data, error } = await supabase
      .from("collections")
      .select(`${COLLECTION_COLUMNS}, nfts(count)`)
      .eq("chain_id", chainId)
      .not("total_volume", "is", null)
      .order("total_volume", { ascending: false, nullsFirst: false })
      .limit(safeLimit)

    if (error) throw error
    return ((data ?? []) as CollectionRowWithCount[]).map(toCollection)
  }

  /**
   * Collections with their top bid included.
   * Resolves the N+1 by fetching all top bids in a single query.
   */
  static async getCollectionsWithTopBids(
    supabase: SupabaseClient,
    options: { chainId: number; page?: number; limit?: number; search?: string },
  ): Promise<{ collections: Collection[]; total: number; page: number; limit: number; totalPages: number }> {
    const { search } = options
    const chainId = requireSupportedChain(options.chainId)
    const page = clampInt(options?.page, 1, 1, 100_000)
    const limit = clampInt(options?.limit, 20, 1, 100)

    const collectionsResult = await this.getCollections(supabase, {
      page,
      limit,
      chainId,
      sortBy: "volume",
      search,
    })
    if (collectionsResult.collections.length === 0) return { ...collectionsResult, collections: [] }

    const addresses = collectionsResult.collections.map((collection) => collection.contract_address.toLowerCase())

    // Single fetch for all top bids
    const { data: bids } = await supabase
      .from("collection_bids")
      .select("collection_address, price::text, bidder_wallet, created_at")
      .eq("is_active", true)
      .eq("chain_id", chainId)
      .in("collection_address", addresses)
      .order("price", { ascending: false })

    // Build a map: only the highest bid per collection
    const topBidMap = new Map<string, CollectionBidRow>()
    for (const bid of bids ?? []) {
      const key = String(bid.collection_address).toLowerCase()
      if (!topBidMap.has(key)) topBidMap.set(key, bid as CollectionBidRow)
    }

    return {
      ...collectionsResult,
      collections: collectionsResult.collections.map((collection) => ({
        ...collection,
        top_bid: topBidMap.get(collection.contract_address.toLowerCase()) ?? undefined,
      })),
    }
  }

  /**
   * Top 5 collections by SALE volume in the last 24h on ONE chain.
   *
   * Replaces the RPC get_top_collections_volume_24h(), which takes no chain and
   * also matched 'TOKEN BID ACCEPTED' / 'COLLECTION BID ACCEPTED' (never
   * written; had they matched, bid sales would count twice next to SALE).
   * Reads activity (price is wei text) and aggregates in bigint.
   */
  static async getTopCollectionsByVolume24h(supabase: SupabaseClient, chainId: number, now: Date = new Date()): Promise<CollectionWith24hStats[]> {
    chainId = requireSupportedChain(chainId)
    try {
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from("activity")
        .select("collection_address, price")
        .eq("chain_id", chainId)
        .eq("event", "SALE")
        .gte("created_at", since)
        .not("price", "is", null)
        .limit(SALES_24H_ROW_CAP)

      if (error) throw error
      const volumeData = aggregateSales24h((data ?? []) as Sale24hRow[])
      if (!volumeData.length) return []

      const addresses = volumeData.map((item) => item.collection_address)

      const { data: collections, error: colErr } = await supabase.from("collections").select(`${COLLECTION_COLUMNS}, nfts(count)`).in("contract_address", addresses).eq("chain_id", chainId)

      if (colErr) throw colErr

      const collectionMap = new Map(((collections ?? []) as CollectionRowWithCount[]).map((collection) => [collection.contract_address.toLowerCase(), toCollection(collection)]))

      return volumeData.flatMap((volume, index) => {
        const collection = collectionMap.get(volume.collection_address)
        if (!collection) return []

        return [
          {
            ...collection,
            volume_24h: volume.volume_wei,
            sales_24h: volume.sales,
            rank: index + 1,
          },
        ]
      })
    } catch (error) {
      console.error("Error getting top collections by 24h volume:", error)
      return []
    }
  }
}
