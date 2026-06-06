// services/nft.service.ts
import { supabase } from "@/lib/supabase/client"
import { StringXor } from "next/dist/compiled/webpack/webpack"
import { Address } from "viem"

const ZERO = "0x0000000000000000000000000000000000000000"
const DEFAULT_CHAIN = 11155111

export class NFTService {
  /**
   * Detalles completos de un NFT.
   * Todas las queries en paralelo, sin roundtrips adicionales.
   */
  static async getNFTDetail(collectionAddress: Address, tokenId: string) {
    try {
      const [nftRes, listingRes, bidsRes, collectionRes, historyRes] = await Promise.allSettled([
        supabase.from("nfts").select("*").eq("collection_address", collectionAddress.toLowerCase()).eq("token_id", tokenId).single(),

        supabase.from("listings").select("*").eq("collection_address", collectionAddress.toLowerCase()).eq("token_id", tokenId).eq("is_active", true).maybeSingle(),

        supabase.from("token_bids").select("*").eq("collection_address", collectionAddress.toLowerCase()).eq("token_id", tokenId).eq("is_active", true).order("price", { ascending: false }),

        supabase.from("collections").select("*").eq("contract_address", collectionAddress.toLowerCase()).single(),

        supabase.from("activity").select("*").eq("collection_address", collectionAddress.toLowerCase()).eq("token_id", tokenId).order("created_at", { ascending: false }).limit(50),
      ])

      if (nftRes.status === "rejected" || !nftRes.value.data) return null

      return {
        ...nftRes.value.data,
        listing: listingRes.status === "fulfilled" ? listingRes.value.data : undefined,
        bids: bidsRes.status === "fulfilled" ? (bidsRes.value.data ?? []) : [],
        collection: collectionRes.status === "fulfilled" ? collectionRes.value.data : undefined,
        history: historyRes.status === "fulfilled" ? (historyRes.value.data ?? []) : [],
      }
    } catch (error) {
      console.error("Error fetching NFT detail:", error)
      return null
    }
  }

  /**
   * NFTs de una colección con paginación.
   * Corrige el bug de doble subquery para onlyListed ejecutando listedIds una sola vez.
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

    // Resolver listedIds una sola vez si hace falta
    let listedIds: string[] | null = null
    if (onlyListed) {
      const { data } = await supabase.from("listings").select("token_id").eq("collection_address", addr).eq("is_active", true)

      listedIds = data?.map((l) => l.token_id) ?? []
      if (listedIds.length === 0) {
        return { nfts: [], page, limit, total: 0, totalPages: 0, hasMore: false }
      }
    }

    // Query de count separada con head:true — evita el GenericStringError del SDK
    const countQuery = supabase.from("nfts").select("*", { count: "exact", head: true }).eq("collection_address", addr).eq("chain_id", DEFAULT_CHAIN).neq("owner_wallet", ZERO)

    const { count, error: countErr } = listedIds ? await countQuery.in("token_id", listedIds) : await countQuery

    if (countErr) throw countErr

    // Query de datos tipada correctamente con select("*")
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
    return { nfts: enriched, page, limit, total: count ?? 0, totalPages, hasMore: page < totalPages }
  }

  /**
   * NFTs de un owner con paginación.
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
    const { page = 1, limit = 24, collectionAddress, onlyListed = false, sortBy = "id", sortDir = "asc" } = options || {}

    const from = (page - 1) * limit
    const to = from + limit - 1
    const owner = ownerAddress.toLowerCase()

    // Resolver listedIds una sola vez
    let listedIds: string[] | null = null
    if (onlyListed) {
      const { data } = await supabase.from("listings").select("token_id").eq("seller_wallet", owner).eq("is_active", true)

      listedIds = data?.map((l) => l.token_id) ?? []
      if (listedIds.length === 0) {
        return { nfts: [], page, limit, total: 0, totalPages: 0, hasMore: false }
      }
    }

    // Count separado con head:true
    const countQuery = supabase.from("nfts").select("*", { count: "exact", head: true }).eq("owner_wallet", owner).eq("chain_id", DEFAULT_CHAIN)

    if (collectionAddress) countQuery.eq("collection_address", collectionAddress.toLowerCase())

    const { count, error: countErr } = listedIds ? await countQuery.in("token_id", listedIds) : await countQuery

    if (countErr) throw countErr

    // Query de datos tipada con select("*")
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
    return { nfts: enriched, page, limit, total: count ?? 0, totalPages, hasMore: page < totalPages }
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
   * Mapa token_id → listing activo.
   * Si filterBySeller=true filtra por seller_wallet (útil en portfolio de usuario).
   */
  private static async fetchListingsMap(addressOrSeller: string, tokenIds: string[], filterBySeller = false): Promise<Map<string, any>> {
    if (tokenIds.length === 0) return new Map()

    let q = supabase.from("listings").select("id, price, seller_wallet, token_id, expires_at, is_active, collection_address").eq("is_active", true).in("token_id", tokenIds)

    q = filterBySeller ? q.eq("seller_wallet", addressOrSeller) : q.eq("collection_address", addressOrSeller)

    const { data } = await q
    return new Map((data || []).map((l) => [l.token_id, l]))
  }

  /**
   * Mapa token_id → bid más alto activo.
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

    // Mantener solo el bid más alto por token
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
   * Mapa collection_address → collection bid más alto activo.
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
   * Mapa contract_address → collection.
   * Resuelve el doble roundtrip: va directamente a collections con las direcciones.
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
