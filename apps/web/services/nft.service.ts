// services/nft.service.ts
import { supabase } from "@/lib/supabase/client"
import { Address } from "viem"
import { DEFAULT_CHAIN_ID, ZERO_ADDRESS } from "@marketplace/shared"
import { NFTDetail } from "@/types/user.types"

const ZERO = ZERO_ADDRESS
const DEFAULT_CHAIN = DEFAULT_CHAIN_ID

export class NFTService {
  /**
   * Full detail of an NFT (row + listing + bids + collection + history).
   * All queries run in parallel — no extra roundtrips.
   */
  static async getNFTDetail(collectionAddress: Address, tokenId: string): Promise<NFTDetail | null> {
    try {
      const [nftRes, listingRes, bidsRes, collectionRes, historyRes] = await Promise.allSettled([
        supabase.from("nfts").select("*").eq("collection_address", collectionAddress.toLowerCase()).eq("token_id", tokenId).single(),

        supabase.from("listings").select("*").eq("collection_address", collectionAddress.toLowerCase()).eq("token_id", tokenId).eq("is_active", true).maybeSingle(),

        supabase.from("token_bids").select("*").eq("collection_address", collectionAddress.toLowerCase()).eq("token_id", tokenId).eq("is_active", true).order("price", { ascending: false }),

        supabase.from("collections").select("*").eq("contract_address", collectionAddress.toLowerCase()).single(),

        supabase.from("activity").select("*").eq("collection_address", collectionAddress.toLowerCase()).eq("token_id", tokenId).order("created_at", { ascending: false }).limit(50),
      ])

      if (nftRes.status === "rejected" || !nftRes.value.data) return null

      // Addresses/metadata come back as loose `string`/`Json` from the DB types;
      // the domain types narrow them to `Address` / `NFTMetadata`.
      return {
        ...nftRes.value.data,
        listing: listingRes.status === "fulfilled" ? listingRes.value.data : undefined,
        bids: bidsRes.status === "fulfilled" ? (bidsRes.value.data ?? []) : [],
        collection: collectionRes.status === "fulfilled" ? collectionRes.value.data : undefined,
        history: historyRes.status === "fulfilled" ? (historyRes.value.data ?? []) : [],
      } as NFTDetail
    } catch (error) {
      console.error("Error fetching NFT detail:", error)
      return null
    }
  }

  /**
   * Collection NFTs with pagination.
   * Fixes the double-subquery bug for onlyListed by resolving listedIds once.
   */
  static async getCollectionNFTs(
    collectionAddress: Address,
    options?: {
      page?: number
      limit?: number
      onlyListed?: boolean
      sortBy?: "price" | "id"
      sortDir?: "asc" | "desc"
    },
  ) {
    const { page = 1, limit = 24, onlyListed = false, sortBy = "id", sortDir = "asc" } = options || {}

    const from = (page - 1) * limit
    const to = from + limit - 1
    const addr = collectionAddress.toLowerCase()

    // Resolve listedIds once if needed
    let listedIds: string[] | null = null
    if (onlyListed) {
      const { data } = await supabase.from("listings").select("token_id").eq("collection_address", addr).eq("is_active", true)

      listedIds = data?.map((l) => l.token_id) ?? []
      if (listedIds.length === 0) {
        return {
          nfts: [],
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasMore: false,
        }
      }
    }

    // Separate count query with head:true — avoids the SDK's GenericStringError
    const countQuery = supabase.from("nfts").select("*", { count: "exact", head: true }).eq("collection_address", addr).eq("chain_id", DEFAULT_CHAIN).neq("owner_wallet", ZERO)

    const { count, error: countErr } = listedIds ? await countQuery.in("token_id", listedIds) : await countQuery

    if (countErr) throw countErr

    // Typed data query with select("*")
    let nftsQuery = supabase.from("nfts").select("*").eq("collection_address", addr).eq("chain_id", DEFAULT_CHAIN).neq("owner_wallet", ZERO)

    if (listedIds) nftsQuery = nftsQuery.in("token_id", listedIds)
    if (sortBy === "id") nftsQuery = nftsQuery.order("token_id", { ascending: sortDir === "asc" })

    const { data: nfts, error } = await nftsQuery.range(from, to)
    if (error) throw error

    const tokenIds = nfts?.map((n) => n.token_id) ?? []
    const [listingsMap, topBidsMap] = await Promise.all([this.fetchListingsMap(addr, tokenIds), this.fetchTopBidsMap(addr, tokenIds)])

    let enriched = (nfts || []).map((nft) => ({
      ...nft,
      active_listing: listingsMap.get(nft.token_id) ?? null,
      topBid: topBidsMap.get(nft.token_id) ?? null,
    }))

    if (sortBy === "price") {
      enriched = sortByPrice(enriched, sortDir)
    }

    const totalPages = Math.ceil((count ?? 0) / limit)
    return {
      nfts: enriched,
      page,
      limit,
      total: count ?? 0,
      totalPages,
      hasMore: page < totalPages,
    }
  }

  /**
   * An owner's NFTs with pagination.
   */
  static async getNFTsByOwner(
    ownerAddress: Address,
    options?: {
      page?: number
      limit?: number
      collectionAddress?: Address
      onlyListed?: boolean
      sortBy?: "price" | "id"
      sortDir?: "asc" | "desc"
    },
  ) {
    // Guard: return empty result if ownerAddress is not a valid string
    if (typeof ownerAddress !== "string" || !ownerAddress) {
      return {
        nfts: [],
        page: 1,
        limit: 24,
        total: 0,
        totalPages: 0,
        hasMore: false,
      }
    }

    const { page = 1, limit = 24, collectionAddress, onlyListed = false, sortBy = "id", sortDir = "asc" } = options || {}

    const from = (page - 1) * limit
    const to = from + limit - 1
    const owner = ownerAddress.toLowerCase()

    // Resolve listedIds once
    let listedIds: string[] | null = null
    if (onlyListed) {
      const { data } = await supabase.from("listings").select("token_id").eq("seller_wallet", owner).eq("is_active", true)

      listedIds = data?.map((l) => l.token_id) ?? []
      if (listedIds.length === 0) {
        return {
          nfts: [],
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasMore: false,
        }
      }
    }

    // Count separado con head:true
    const countQuery = supabase.from("nfts").select("*", { count: "exact", head: true }).eq("owner_wallet", owner).eq("chain_id", DEFAULT_CHAIN)

    if (collectionAddress) countQuery.eq("collection_address", collectionAddress.toLowerCase())

    const { count, error: countErr } = listedIds ? await countQuery.in("token_id", listedIds) : await countQuery

    if (countErr) throw countErr

    // Typed data query with select("*")
    let nftsQuery = supabase.from("nfts").select("*").eq("owner_wallet", owner).eq("chain_id", DEFAULT_CHAIN)

    if (collectionAddress) nftsQuery = nftsQuery.eq("collection_address", collectionAddress.toLowerCase())
    if (listedIds) nftsQuery = nftsQuery.in("token_id", listedIds)
    if (sortBy === "id") nftsQuery = nftsQuery.order("token_id", { ascending: sortDir === "asc" })

    const { data: nfts, error } = await nftsQuery.range(from, to)
    if (error) throw error

    const tokenIds = nfts?.map((n) => n.token_id) ?? []
    const collectionAddresses = [...new Set(nfts?.map((n) => n.collection_address) ?? [])] as Address[]

    const [listingsMap, topBidsMap, topColBidsMap, collectionsMap] = await Promise.all([
      this.fetchListingsMap(owner, tokenIds, true), // true = filter by seller_wallet
      this.fetchTopBidsMap(null, tokenIds, collectionAddresses),
      this.fetchTopCollectionBidsMap(collectionAddresses),
      this.fetchCollectionsMap(collectionAddresses),
    ])

    let enriched = (nfts || []).map((nft) => {
      const tokenBid = topBidsMap.get(nft.token_id) ?? null
      const colBid = topColBidsMap.get(nft.collection_address.toLowerCase()) ?? null
      const highestBid = tokenBid && colBid ? (BigInt(tokenBid.price) >= BigInt(colBid.price) ? tokenBid : colBid) : (tokenBid ?? colBid)

      return {
        ...nft,
        active_listing: listingsMap.get(nft.token_id) ?? null,
        topBid: highestBid,
        collection: collectionsMap.get(nft.collection_address.toLowerCase()) ?? null,
      }
    })

    if (sortBy === "price") enriched = sortByPrice(enriched, sortDir)

    const totalPages = Math.ceil((count ?? 0) / limit)
    return {
      nfts: enriched,
      page,
      limit,
      total: count ?? 0,
      totalPages,
      hasMore: page < totalPages,
    }
  }

  /**
   * Buscar NFTs por query.
   */
  static async searchNFTs(query: string, limit = 10) {
    const { data, error } = await supabase.from("nfts").select(`*, collections!inner(name)`).or(`token_id.eq.${query},metadata->name.ilike.%${query}%`).limit(limit)

    if (error) throw error
    return data || []
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  /**
   * Map token_id → active listing.
   * When filterBySeller=true filters by seller_wallet (useful in a user portfolio).
   */
  private static async fetchListingsMap(addressOrSeller: string, tokenIds: string[], filterBySeller = false): Promise<Map<string, any>> {
    if (tokenIds.length === 0) return new Map()

    let q = supabase.from("listings").select("id, price, seller_wallet, token_id, expires_at, is_active, collection_address").eq("is_active", true).in("token_id", tokenIds)

    q = filterBySeller ? q.eq("seller_wallet", addressOrSeller) : q.eq("collection_address", addressOrSeller)

    const { data } = await q
    return new Map((data || []).map((l) => [l.token_id, l]))
  }

  /**
   * Map token_id → highest active bid.
   */
  private static async fetchTopBidsMap(collectionAddress: string | null, tokenIds: string[], collectionAddresses?: Address[]): Promise<Map<string, any>> {
    if (tokenIds.length === 0) return new Map()

    let q = supabase.from("token_bids").select("token_id, price, bidder_wallet, collection_address").eq("is_active", true).in("token_id", tokenIds)

    if (collectionAddress) {
      q = q.eq("collection_address", collectionAddress)
    } else if (collectionAddresses?.length) {
      q = q.in(
        "collection_address",
        collectionAddresses.map((a) => a.toLowerCase()),
      )
    }

    const { data } = await q

    // Keep only the highest bid per token
    const map = new Map<string, any>()
    data?.forEach((bid) => {
      const existing = map.get(String(bid.token_id))
      if (!existing || BigInt(Number(bid.price)) > BigInt(existing.price)) {
        map.set(String(bid.token_id), bid)
      }
    })
    return map
  }

  /**
   * Map collection_address → highest active collection bid.
   */
  private static async fetchTopCollectionBidsMap(collectionAddresses: Address[]): Promise<Map<string, any>> {
    if (collectionAddresses.length === 0) return new Map()

    const { data } = await supabase
      .from("collection_bids")
      .select("collection_address, price, bidder_wallet")
      .eq("is_active", true)
      .in(
        "collection_address",
        collectionAddresses.map((a) => a.toLowerCase()),
      )
      .order("price", { ascending: false })

    const map = new Map<string, any>()
    data?.forEach((bid) => {
      if (!map.has(String(bid.collection_address))) map.set(String(bid.collection_address), bid)
    })
    return map
  }

  /**
   * Map contract_address → collection.
   * Avoids the double roundtrip: queries collections directly by address.
   */
  private static async fetchCollectionsMap(collectionAddresses: Address[]): Promise<Map<string, any>> {
    if (collectionAddresses.length === 0) return new Map()

    const { data } = await supabase
      .from("collections")
      .select("*")
      .in(
        "contract_address",
        collectionAddresses.map((a) => a.toLowerCase()),
      )

    return new Map((data || []).map((c) => [c.contract_address.toLowerCase(), c]))
  }
}

// ─── sort helper ─────────────────────────────────────────────────────────────

function sortByPrice(nfts: any[], dir: "asc" | "desc") {
  return [...nfts].sort((a, b) => {
    const ap = a.active_listing?.price ? BigInt(a.active_listing.price) : null
    const bp = b.active_listing?.price ? BigInt(b.active_listing.price) : null
    if (ap === null && bp === null) return 0
    if (ap === null) return 1
    if (bp === null) return -1
    const cmp = ap < bp ? -1 : ap > bp ? 1 : 0
    return dir === "asc" ? cmp : -cmp
  })
}
