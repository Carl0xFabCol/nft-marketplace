import { Database, Tables } from "@/lib/supabase/types"
import { supabase } from "@/lib/supabase/client"
import { Address } from "viem"

type Listing = Tables<"listings">

export class ListingService {
  static async getActiveListings(collectionAddress: string): Promise<Listing[]> {
    const { data, error } = await supabase.from("listings").select("*").eq("is_active", true).eq("collection_address", collectionAddress.toLowerCase())

    if (error) throw error
    return data || []
  }

  static async createListing(listing: Database["public"]["Tables"]["listings"]["Insert"]) {
    const { data, error } = await supabase.from("listings").insert(listing).select().single()

    if (error) throw error
    return data
  }

  static async updateListing(id: string, updates: Database["public"]["Tables"]["listings"]["Update"]) {
    const { data, error } = await supabase.from("listings").update(updates).eq("id", id).select().single()

    if (error) throw error
    return data
  }

  static async getUserListings(userAddress: Address): Promise<Listing[]> {
    const { data, error } = await supabase.from("listings").select("*").eq("seller_wallet", userAddress.toLowerCase()).eq("is_active", true).order("created_at", { ascending: false })

    if (error) throw error
    return data || []
  }

  static async getListingsWithCollection() {
    const { data, error } = await supabase.from("listings").select(`*, collections(name, symbol, floor_price)`).eq("is_active", true)

    if (error) throw error
    return data
  }
}
