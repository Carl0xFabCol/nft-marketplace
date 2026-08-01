// services/collection.service.ts
import { SupabaseClient } from "@supabase/supabase-js"
import { Collection } from "@/types/user.types"

export type { Collection }

// ─── helpers ────────────────────────────────────────────────────────────────

import { DEFAULT_CHAIN_ID, ZERO_ADDRESS } from "@marketplace/shared"
const ZERO = ZERO_ADDRESS
const DEFAULT_CHAIN = DEFAULT_CHAIN_ID

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
  ) {
    const { page = 1, limit = 20, sortBy = "volume", sortDir = "desc", verified, search, chainId = DEFAULT_CHAIN } = options || {}

    const from = (page - 1) * limit
    const to = from + limit - 1

    // Una sola query — nft_count viene del aggregate de Supabase
    let query = supabase.from("collections").select(`*, nfts(count)`, { count: "exact" }).eq("chain_id", chainId).neq("nfts.owner_wallet", ZERO)

    if (verified !== undefined) query = query.eq("is_verified", verified)
    if (search) {
      query = query.or(`name.ilike.%${search}%,symbol.ilike.%${search}%,contract_address.ilike.%${search}%`)
    }

    const sortColumn = sortBy === "volume" ? "total_volume" : sortBy === "sales" ? "total_sales" : sortBy === "name" ? "name" : "created_at"

    query = query.order(sortColumn, {
      ascending: sortDir === "asc",
      nullsFirst: false,
    })

    const { data, error, count } = await query.range(from, to)
    if (error) throw error

    const collections = (data || []).map((col: any) => ({
      ...col,
      nft_count: col.nfts?.[0]?.count ?? 0,
      nfts: undefined,
    }))

    return {
      collections,
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    }
  }

  /**
   * Top N collections by volume.
   */
  static async getTopCollectionsByVolume(supabase: SupabaseClient, limit = 10, chainId = DEFAULT_CHAIN) {
    const { data, error } = await supabase
      .from("collections")
      .select(`*, nfts(count)`)
      .eq("chain_id", chainId)
      .not("total_volume", "is", null)
      .order("total_volume", { ascending: false, nullsFirst: false })
      .limit(limit)

    if (error) throw error
    return (data || []).map((col: any) => ({
      ...col,
      nft_count: col.nfts?.[0]?.count ?? 0,
      nfts: undefined,
    }))
  }

  /**
   * Collections with their top bid included.
   * Resolves the N+1 by fetching all top bids in a single query.
   */
  static async getCollectionsWithTopBids(supabase: SupabaseClient, options?: { page?: number; limit?: number; chainId?: number }) {
    const { page = 1, limit = 20, chainId = DEFAULT_CHAIN } = options || {}

    const collectionsResult = await this.getCollections(supabase, {
      page,
      limit,
      chainId,
      sortBy: "volume",
    })
    if (collectionsResult.collections.length === 0) return { ...collectionsResult, collections: [] }

    const addresses = collectionsResult.collections.map((c: any) => c.contract_address.toLowerCase())

    // Single fetch for all top bids
    const { data: bids } = await supabase
      .from("collection_bids")
      .select("collection_address, price, bidder_wallet, created_at")
      .eq("is_active", true)
      .in("collection_address", addresses)
      .order("price", { ascending: false })

    // Build a map: only the highest bid per collection
    const topBidMap = new Map<string, any>()
    bids?.forEach((bid) => {
      if (!topBidMap.has(String(bid.collection_address))) {
        topBidMap.set(String(bid.collection_address), bid)
      }
    })

    return {
      ...collectionsResult,
      collections: collectionsResult.collections.map((col: any) => {
        return {
          ...col,
          top_bid: topBidMap.get(col.contract_address.toLowerCase()) ?? undefined,
        }
      }),
    }
  }

  /**
   * Top 5 collections by volume in the last 24h.
   */
  static async getTopCollectionsByVolume24h(supabase: SupabaseClient, chainId = DEFAULT_CHAIN) {
    try {
      const { data: volumeData, error } = await (supabase.rpc as any)("get_top_collections_volume_24h")

      if (error) throw error
      if (!volumeData?.length) return []

      const addresses = volumeData.map((i: any) => i.collection_address)

      const { data: collections, error: colErr } = await supabase.from("collections").select(`*, nfts(count)`).in("contract_address", addresses).eq("chain_id", chainId)

      if (colErr) throw colErr
      return volumeData.map((vol: any, idx: number) => {
        const col = collections?.find((c: any) => c.contract_address.toLowerCase() === vol.collection_address.toLowerCase())
        return {
          ...col,
          nft_count: (col as any)?.nfts?.[0]?.count ?? 0,
          nfts: undefined,
          volume_24h: vol.total_volume ?? 0,
          sales_24h: vol.total_sales ?? 0,
          rank: idx + 1,
        }
      })
    } catch (error) {
      console.error("Error getting top collections by 24h volume:", error)
      return []
    }
  }

}
