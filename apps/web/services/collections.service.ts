// services/collections.service.ts
import { SupabaseClient } from "@supabase/supabase-js"
import { Address } from "viem"
import { Collection } from "@/types/user.types"
import { Tables } from "@/lib/supabase/types"
import { clampInt, sanitizePostgrestSearch } from "@/lib/validation"

export type { Collection }

// ─── helpers ────────────────────────────────────────────────────────────────

import { DEFAULT_CHAIN_ID, ZERO_ADDRESS } from "@marketplace/shared"
const ZERO = ZERO_ADDRESS
const DEFAULT_CHAIN = DEFAULT_CHAIN_ID

type CollectionRow = Tables<"collections">
type CollectionRowWithCount = CollectionRow & { nfts?: Array<{ count: number }> }
type CollectionBidRow = Tables<"collection_bids">
type Volume24hRow = { collection_address: string; total_sales: number; total_volume: number }

export type CollectionWith24hStats = Collection & {
  volume_24h: number
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
    options?: {
      page?: number
      limit?: number
      sortBy?: "volume" | "sales" | "name" | "created"
      sortDir?: "asc" | "desc"
      verified?: boolean
      search?: string
      chainId?: number
    },
  ): Promise<{ collections: Collection[]; total: number; page: number; limit: number; totalPages: number }> {
    const { sortBy = "volume", sortDir = "desc", verified, search, chainId = DEFAULT_CHAIN } = options || {}
    const page = clampInt(options?.page, 1, 1, 100_000)
    const limit = clampInt(options?.limit, 20, 1, 100)

    const from = (page - 1) * limit
    const to = from + limit - 1

    // Single query — nft_count comes from Supabase's aggregate count.
    let query = supabase.from("collections").select(`*, nfts(count)`, { count: "exact" }).eq("chain_id", chainId).neq("nfts.owner_wallet", ZERO)

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
  static async getTopCollectionsByVolume(supabase: SupabaseClient, limit = 10, chainId = DEFAULT_CHAIN): Promise<Collection[]> {
    const safeLimit = clampInt(limit, 10, 1, 100)

    const { data, error } = await supabase
      .from("collections")
      .select(`*, nfts(count)`)
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
    options?: { page?: number; limit?: number; chainId?: number; search?: string },
  ): Promise<{ collections: Collection[]; total: number; page: number; limit: number; totalPages: number }> {
    const { chainId = DEFAULT_CHAIN, search } = options || {}
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
      .select("collection_address, price, bidder_wallet, created_at")
      .eq("is_active", true)
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
   * Top 5 collections by volume in the last 24h.
   */
  static async getTopCollectionsByVolume24h(supabase: SupabaseClient, chainId = DEFAULT_CHAIN): Promise<CollectionWith24hStats[]> {
    try {
      const { data, error } = await supabase.rpc("get_top_collections_volume_24h")
      const volumeData = (data ?? []) as Volume24hRow[]

      if (error) throw error
      if (!volumeData.length) return []

      const addresses = volumeData.map((item) => item.collection_address)

      const { data: collections, error: colErr } = await supabase.from("collections").select(`*, nfts(count)`).in("contract_address", addresses).eq("chain_id", chainId)

      if (colErr) throw colErr

      const collectionMap = new Map(((collections ?? []) as CollectionRowWithCount[]).map((collection) => [collection.contract_address.toLowerCase(), toCollection(collection)]))

      return volumeData.flatMap((volume, index) => {
        const collection = collectionMap.get(volume.collection_address.toLowerCase())
        if (!collection) return []

        return [
          {
            ...collection,
            volume_24h: volume.total_volume ?? 0,
            sales_24h: volume.total_sales ?? 0,
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
