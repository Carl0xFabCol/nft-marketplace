// services/user.service.ts
import { SupabaseClient } from "@supabase/supabase-js"
import { Address, isAddress } from "viem"
import { UserCollectionSummary, UserPageData, UserListing, UserTokenBid, UserCollectionBid, Activity, UserProfile, ProfileNftOption } from "@/types/user.types"
import { clampInt } from "@/lib/validation"

import { DEFAULT_CHAIN_ID } from "@marketplace/shared"
const DEFAULT_CHAIN = DEFAULT_CHAIN_ID

export class UserService {
  /**
   * Public profile row for a wallet (username, bio and selected PFP).
   */
  static async getUserProfile(supabase: SupabaseClient, userAddress: Address): Promise<UserProfile | null> {
    if (!isAddress(userAddress)) return null

    const { data, error } = await supabase
      .from("profiles")
      .select("id, wallet, username, bio, avatar_url, created_at")
      .eq("wallet", userAddress.toLowerCase())
      .maybeSingle()

    if (error) throw error
    return (data as UserProfile | null) ?? null
  }

  /**
   * NFTs owned by the wallet that have an image, used as PFP choices.
   */
  static async getProfileAvatarOptions(supabase: SupabaseClient, userAddress: Address): Promise<ProfileNftOption[]> {
    if (!isAddress(userAddress)) return []

    const { data, error } = await supabase
      .from("nfts")
      .select("id, collection_address, token_id, name, image_url")
      .eq("owner_wallet", userAddress.toLowerCase())
      .eq("chain_id", DEFAULT_CHAIN)
      .not("image_url", "is", null)
      .order("name", { ascending: true })
      .limit(300)

    if (error) throw error

    return (data ?? [])
      .filter((nft) => Boolean(nft.image_url))
      .map((nft) => ({
        id: nft.id,
        collection_address: nft.collection_address as Address,
        token_id: nft.token_id,
        name: nft.name,
        image_url: nft.image_url as string,
      }))
  }

  static async getUserData(supabase: SupabaseClient, userAddress: Address): Promise<UserPageData> {
    const [listingsRes, colBidsRes, tokenBidsRes, collectionsRes, nftsRes, activityRes] = await Promise.allSettled([
      this.getUserListings(supabase, userAddress),
      this.getUserCollectionBids(supabase, userAddress),
      this.getUserTokenBids(supabase, userAddress),
      this.getUserCollections(supabase, userAddress),
      // Match the inventory's default sort so the first render is consistent
      // with the sort indicator shown in the UI.
      this.getUserNFTsPaginated(supabase, userAddress, { page: 1, limit: 24, sortBy: "price", sortDir: "asc" }),
      this.getUserActivityPaginated(supabase, userAddress, { page: 1, limit: 24 }),
    ])

    const listings = listingsRes.status === "fulfilled" ? listingsRes.value : []
    const collBids = colBidsRes.status === "fulfilled" ? colBidsRes.value : []
    const tokenBids = tokenBidsRes.status === "fulfilled" ? tokenBidsRes.value : []
    const collections = collectionsRes.status === "fulfilled" ? collectionsRes.value : []
    const nftsPage = nftsRes.status === "fulfilled" ? nftsRes.value : { nfts: [], hasMore: false }
    const activityPage = activityRes.status === "fulfilled" ? activityRes.value : { activity: [], page: 1, limit: 24, total: 0, totalPages: 0 }

    return {
      listings,
      collectionBids: collBids,
      tokenBids,
      collections,
      nfts: nftsPage.nfts,
      hasMore: nftsPage.hasMore,
      activity: activityPage.activity,
      activityTotalPages: activityPage.totalPages,
    }
  }

  /**
   * User NFTs with pagination — delegates to NFTService to avoid duplication.
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
    // Import here to avoid a circular dependency when services share a bundle
    const { NFTService } = await import("./nft.service")
    return NFTService.getNFTsByOwner(userAddress, options)
  }

  /**
   * The user's active listings.
   */
  static async getUserListings(supabase: SupabaseClient, userAddress: Address): Promise<UserListing[]> {
    const { data, error } = await supabase.from("listings").select("*").eq("seller_wallet", userAddress.toLowerCase()).eq("is_active", true).order("created_at", { ascending: false })

    if (error) throw error
    return (data as UserListing[]) || []
  }

  /**
   * The user's active collection bids.
   */
  static async getUserCollectionBids(supabase: SupabaseClient, userAddress: Address): Promise<UserCollectionBid[]> {
    const { data, error } = await supabase.from("collection_bids").select("*").eq("bidder_wallet", userAddress.toLowerCase()).eq("is_active", true).order("created_at", { ascending: false })

    if (error) throw error
    return (data as UserCollectionBid[]) || []
  }

  /**
   * The user's active token bids.
   */
  static async getUserTokenBids(supabase: SupabaseClient, userAddress: Address): Promise<UserTokenBid[]> {
    const { data, error } = await supabase.from("token_bids").select("*").eq("bidder_wallet", userAddress.toLowerCase()).eq("is_active", true).order("created_at", { ascending: false })

    if (error) throw error
    return (data as UserTokenBid[]) || []
  }

  /**
   * Collections related to the user (owned NFTs, placed bids).
   */
  static async getUserCollections(supabase: SupabaseClient, userAddress: Address): Promise<UserCollectionSummary[]> {
    const addr = userAddress.toLowerCase()

    const [nftColRes, colBidRes, tokenBidRes] = await Promise.all([
      supabase.from("collections").select(`*, user_nfts:nfts!inner(owner_wallet, collection_address)`).eq("nfts.owner_wallet", addr),

      supabase.from("collection_bids").select(`collection_address, collections!inner(*)`).eq("bidder_wallet", addr).eq("is_active", true),

      supabase.from("token_bids").select(`collection_address, collections!inner(*)`).eq("bidder_wallet", addr).eq("is_active", true),
    ])

    type OwnedCollectionRow = UserCollectionSummary & {
      user_nfts?: Array<{ owner_wallet: string; collection_address: string }>
    }
    type BidJoinRow = {
      collections: UserCollectionSummary | UserCollectionSummary[] | null
    }

    const map = new Map<string, UserCollectionSummary>()
    const normalize = (address: string | null | undefined) => (address ?? "").toLowerCase()

    const joinCollection = (value: BidJoinRow["collections"]) => (Array.isArray(value) ? value[0] : value)

    const addBidFlag = (value: BidJoinRow["collections"], flag: "has_collection_bid" | "has_token_bid") => {
      const collection = joinCollection(value)
      const contract = normalize(collection?.contract_address)
      if (!collection || !contract) return

      const normalized = { ...collection, contract_address: contract as Address }
      const existing = map.get(contract)
      if (existing) {
        existing[flag] = true
      } else {
        map.set(contract, {
          ...normalized,
          user_nft_count: 0,
          has_nfts: false,
          has_collection_bid: flag === "has_collection_bid",
          has_token_bid: flag === "has_token_bid",
        })
      }
    }

    for (const item of (nftColRes.data ?? []) as OwnedCollectionRow[]) {
      const { user_nfts, ...collection } = item
      const contract = normalize(collection.contract_address)
      if (!contract) continue

      map.set(contract, {
        ...collection,
        contract_address: contract as Address,
        user_nft_count: user_nfts?.length ?? 0,
        has_nfts: true,
        has_collection_bid: false,
        has_token_bid: false,
      })
    }

    for (const item of (colBidRes.data ?? []) as BidJoinRow[]) {
      addBidFlag(item.collections, "has_collection_bid")
    }

    for (const item of (tokenBidRes.data ?? []) as BidJoinRow[]) {
      addBidFlag(item.collections, "has_token_bid")
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.has_nfts !== b.has_nfts) return a.has_nfts ? -1 : 1
      if (a.has_collection_bid !== b.has_collection_bid) return a.has_collection_bid ? -1 : 1
      if (a.has_token_bid !== b.has_token_bid) return a.has_token_bid ? -1 : 1
      return (a.name || "").localeCompare(b.name || "")
    })
  }

  /**
   * The user's activity.
   */
  static async getUserActivity(supabase: SupabaseClient, userAddress: Address, options?: { page?: number; limit?: number; sortDir?: "asc" | "desc" }): Promise<Activity[]> {
    const { activity } = await this.getUserActivityPaginated(supabase, userAddress, options)
    return activity
  }

  /**
   * The user's activity with pagination metadata.
   */
  static async getUserActivityPaginated(
    supabase: SupabaseClient,
    userAddress: Address,
    options?: {
      page?: number
      limit?: number
      sortDir?: "asc" | "desc"
    },
  ): Promise<{ activity: Activity[]; page: number; limit: number; total: number; totalPages: number }> {
    const { sortDir = "desc" } = options || {}
    if (!isAddress(userAddress)) throw new Error("Invalid wallet address")

    const page = clampInt(options?.page, 1, 1, 100_000)
    const limit = clampInt(options?.limit, 24, 1, 100)
    const from = (page - 1) * limit
    const to = from + limit - 1
    const addr = userAddress.toLowerCase()

    const { data, error, count } = await supabase
      .from("activity")
      .select("*", { count: "exact" })
      .or(`from.eq.${addr},to.eq.${addr}`)
      .eq("chain_id", DEFAULT_CHAIN)
      .order("created_at", { ascending: sortDir === "asc" })
      .range(from, to)

    if (error) throw error

    const activity = (data || []).map((item) => ({
      ...item,
      type: item.event as Activity["type"],
    })) as Activity[]

    return {
      activity,
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    }
  }
}
