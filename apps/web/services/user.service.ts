// services/listing.service.ts
import { SupabaseClient } from "@supabase/supabase-js"
import { Address } from "viem"

// ─────────────────────────────────────────────────────────────────────────────
// services/user.service.ts
// ─────────────────────────────────────────────────────────────────────────────
import { UserData, UserNFT, UserListing, UserTokenBid, UserCollectionBid, Activity, EnrichedUserNFT } from "@/types/user.types"

const ZERO = "0x0000000000000000000000000000000000000000"
const DEFAULT_CHAIN = 11155111

export class UserService {
  static async getUserData(supabase: SupabaseClient, userAddress: Address): Promise<any> {
    const [listingsRes, colBidsRes, tokenBidsRes, collectionsRes, nftsRes, activityRes] = await Promise.allSettled([
      this.getUserListings(supabase, userAddress),
      this.getUserCollectionBids(supabase, userAddress),
      this.getUserTokenBids(supabase, userAddress),
      this.getUserCollections(supabase, userAddress),
      this.getUserNFTsPaginated(supabase, userAddress, { page: 1, limit: 24 }),
      this.getUserActivity(supabase, userAddress, { page: 1, limit: 24 }),
    ])

    const listings = listingsRes.status === "fulfilled" ? listingsRes.value : []
    const collBids = colBidsRes.status === "fulfilled" ? colBidsRes.value : []
    const tokenBids = tokenBidsRes.status === "fulfilled" ? tokenBidsRes.value : []
    const collections = collectionsRes.status === "fulfilled" ? collectionsRes.value : []
    const nftsPage = nftsRes.status === "fulfilled" ? nftsRes.value : { nfts: [], hasMore: false }
    const activity = activityRes.status === "fulfilled" ? activityRes.value : []

    return {
      listings,
      collectionBids: collBids,
      tokenBids,
      collections,
      nfts: nftsPage.nfts,
      hasMore: nftsPage.hasMore,
      activity,
    }
  }

  /**
   * NFTs del usuario con paginación — delega en NFTService para evitar duplicación.
   */
  static async getUserNFTsPaginated(
    supabase: SupabaseClient,
    userAddress: Address,
    options?: {
      page?: number
      limit?: number
      collectionAddress?: Address
      onlyListed?: boolean
      sortBy?: "price" | "id"
      sortDir?: "asc" | "desc"
    },
  ) {
    // Importar aquí evita dependencia circular si los servicios están en el mismo bundle
    const { NFTService } = await import("./nft.service")
    return NFTService.getNFTsByOwner(userAddress, options)
  }

  /**
   * Listings activos del usuario.
   */
  static async getUserListings(supabase: SupabaseClient, userAddress: Address): Promise<UserListing[]> {
    const { data, error } = await supabase.from("listings").select("*").eq("seller_wallet", userAddress.toLowerCase()).eq("is_active", true).order("created_at", { ascending: false })

    if (error) throw error
    return (data as UserListing[]) || []
  }

  /**
   * Collection bids activos del usuario.
   */
  static async getUserCollectionBids(supabase: SupabaseClient, userAddress: Address): Promise<UserCollectionBid[]> {
    const { data, error } = await supabase.from("collection_bids").select("*").eq("bidder_wallet", userAddress.toLowerCase()).eq("is_active", true).order("created_at", { ascending: false })

    if (error) throw error
    return (data as UserCollectionBid[]) || []
  }

  /**
   * Token bids activos del usuario.
   */
  static async getUserTokenBids(supabase: SupabaseClient, userAddress: Address): Promise<UserTokenBid[]> {
    const { data, error } = await supabase.from("token_bids").select("*").eq("bidder_wallet", userAddress.toLowerCase()).eq("is_active", true).order("created_at", { ascending: false })

    if (error) throw error
    return (data as UserTokenBid[]) || []
  }

  /**
   * Colecciones relacionadas con el usuario (NFTs owned, bids placed).
   */
  static async getUserCollections(supabase: SupabaseClient, userAddress: Address): Promise<any[]> {
    const addr = userAddress.toLowerCase()

    const [nftColRes, colBidRes, tokenBidRes] = await Promise.all([
      supabase.from("collections").select(`*, user_nfts:nfts!inner(owner_wallet, collection_address)`).eq("nfts.owner_wallet", addr),

      supabase.from("collection_bids").select(`collection_address, collections!inner(*)`).eq("bidder_wallet", addr).eq("is_active", true),

      supabase.from("token_bids").select(`collection_address, collections!inner(*)`).eq("bidder_wallet", addr).eq("is_active", true),
    ])

    const map = new Map<string, any>()

    nftColRes.data?.forEach((item: any) => {
      map.set(item.contract_address, {
        ...item,
        user_nft_count: item.user_nfts?.length ?? 0,
        has_nfts: true,
        has_collection_bid: false,
        has_token_bid: false,
        user_nfts: undefined,
      })
    })

    colBidRes.data?.forEach((item: any) => {
      const col = item.collections
      const existing = map.get(col.contract_address)
      if (existing) {
        existing.has_collection_bid = true
      } else {
        map.set(col.contract_address, {
          ...col,
          user_nft_count: 0,
          has_nfts: false,
          has_collection_bid: true,
          has_token_bid: false,
        })
      }
    })

    tokenBidRes.data?.forEach((item: any) => {
      const col = item.collections
      const existing = map.get(col.contract_address)
      if (existing) {
        existing.has_token_bid = true
      } else {
        map.set(col.contract_address, {
          ...col,
          user_nft_count: 0,
          has_nfts: false,
          has_collection_bid: false,
          has_token_bid: true,
        })
      }
    })

    return Array.from(map.values()).sort((a, b) => {
      if (a.has_nfts !== b.has_nfts) return a.has_nfts ? -1 : 1
      if (a.has_collection_bid !== b.has_collection_bid) return a.has_collection_bid ? -1 : 1
      if (a.has_token_bid !== b.has_token_bid) return a.has_token_bid ? -1 : 1
      return (a.name || "").localeCompare(b.name || "")
    })
  }

  /**
   * Actividad del usuario.
   */
  static async getUserActivity(
    supabase: SupabaseClient,
    userAddress: Address,
    options?: {
      page?: number
      limit?: number
      sortDir?: "asc" | "desc"
    },
  ): Promise<Activity[]> {
    const { page = 1, limit = 24, sortDir = "desc" } = options || {}

    const from = (page - 1) * limit
    const to = from + limit - 1
    const addr = userAddress.toLowerCase()

    let activityQuery = supabase
      .from("activity")
      .select("*")
      .or(`from.eq.${addr},to.eq.${addr}`)
      .eq("chain_id", DEFAULT_CHAIN)
      .order("created_at", { ascending: sortDir === "asc" })

    const { data, error } = await activityQuery.range(from, to)
    if (error) throw error

    return (data || []).map((item: any) => ({
      ...item,
      type: item.event,
    })) as Activity[]
  }
}
