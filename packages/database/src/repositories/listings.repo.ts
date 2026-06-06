import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Listing,
  ListingInsert,
  ListingUpdate,
} from "@marketplace/shared";

// ─────────────────────────────────────────────────────────────────────────────
// ListingsRepository
// All Supabase queries for the listings table go through here.
// Convention: Database access goes through repositories (docs/conventions.md).
// ─────────────────────────────────────────────────────────────────────────────

export class ListingsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getActiveByCollection(collectionAddress: string): Promise<Listing[]> {
    const { data, error } = await this.supabase
      .from("listings")
      .select("*")
      .eq("is_active", true)
      .eq("collection_address", collectionAddress.toLowerCase());

    if (error) throw error;
    return (data ?? []) as Listing[];
  }

  async getActiveByUser(userAddress: string): Promise<Listing[]> {
    const { data, error } = await this.supabase
      .from("listings")
      .select("*")
      .eq("seller_wallet", userAddress.toLowerCase())
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as Listing[];
  }

  async getActiveByTokenIds(
    collectionAddress: string,
    tokenIds: string[],
  ): Promise<Listing[]> {
    if (tokenIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from("listings")
      .select(
        "id, price, seller_wallet, token_id, expires_at, is_active, collection_address",
      )
      .eq("is_active", true)
      .eq("collection_address", collectionAddress.toLowerCase())
      .in("token_id", tokenIds);

    if (error) throw error;
    return (data ?? []) as Listing[];
  }

  async getWithCollections() {
    const { data, error } = await this.supabase
      .from("listings")
      .select(`*, collections(name, symbol, floor_price)`)
      .eq("is_active", true);

    if (error) throw error;
    return data;
  }

  async upsert(listing: ListingInsert & { listing_id: string }): Promise<void> {
    const { error } = await this.supabase
      .from("listings")
      .upsert(listing, { onConflict: "listing_id", ignoreDuplicates: false });

    if (error) throw error;
  }

  async update(listingId: string, updates: ListingUpdate): Promise<Listing> {
    const { data, error } = await this.supabase
      .from("listings")
      .update(updates)
      .eq("listing_id", listingId)
      .select()
      .single();

    if (error) throw error;
    return data as Listing;
  }

  async deactivate(listingId: string, updates?: ListingUpdate): Promise<void> {
    const { error } = await this.supabase
      .from("listings")
      .update({ is_active: false, ...updates })
      .eq("listing_id", listingId);

    if (error) throw error;
  }

  /** Optimistic write — used before on-chain confirmation */
  async insert(listing: ListingInsert): Promise<Listing> {
    const { data, error } = await this.supabase
      .from("listings")
      .insert(listing)
      .select()
      .single();

    if (error) throw error;
    return data as Listing;
  }

  async confirmByTxHash(txHash: string): Promise<void> {
    const { error } = await this.supabase
      .from("listings")
      .update({ status: "confirmed" })
      .eq("tx_hash", txHash.toLowerCase());

    if (error) throw error;
  }

  async failByTxHash(txHash: string): Promise<void> {
    const { error } = await this.supabase
      .from("listings")
      .update({ is_active: false, status: "failed" })
      .eq("tx_hash", txHash.toLowerCase());

    if (error) throw error;
  }
}
