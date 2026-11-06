import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Listing,
  ListingInsert,
  ListingUpdate,
} from "@marketplace/shared";
import {
  buildListingId,
  normalizeChainId,
  normalizeCollectionAddress,
  normalizeTokenId,
} from "@marketplace/shared";

// ─────────────────────────────────────────────────────────────────────────────
// ListingsRepository
// All Supabase queries for the listings table go through here.
// Convention: Database access goes through repositories (docs/conventions.md).
// ─────────────────────────────────────────────────────────────────────────────

export class ListingsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getActiveByCollection(collectionAddress: string, chainId: number): Promise<Listing[]> {
    const collection = normalizeCollectionAddress(collectionAddress);
    const chain = normalizeChainId(chainId);
    const { data, error } = await this.supabase
      .from("listings")
      .select("*")
      .eq("is_active", true)
      .eq("chain_id", chain)
      .eq("collection_address", collection);

    if (error) throw error;
    return (data ?? []) as Listing[];
  }

  async getActiveByUser(userAddress: string, chainId: number): Promise<Listing[]> {
    const chain = normalizeChainId(chainId);
    const { data, error } = await this.supabase
      .from("listings")
      .select("*")
      .eq("seller_wallet", userAddress.toLowerCase())
      .eq("chain_id", chain)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as Listing[];
  }

  async getActiveByTokenIds(
    collectionAddress: string,
    tokenIds: string[],
    chainId: number,
  ): Promise<Listing[]> {
    if (tokenIds.length === 0) return [];
    const collection = normalizeCollectionAddress(collectionAddress);
    const chain = normalizeChainId(chainId);
    const tokens = tokenIds.map((tokenId) => normalizeTokenId(tokenId));
    const { data, error } = await this.supabase
      .from("listings")
      .select(
        "id, price, seller_wallet, token_id, expires_at, is_active, collection_address, chain_id",
      )
      .eq("is_active", true)
      .eq("chain_id", chain)
      .eq("collection_address", collection)
      .in("token_id", tokens);

    if (error) throw error;
    return (data ?? []) as Listing[];
  }

  async getWithCollections(chainId: number) {
    const chain = normalizeChainId(chainId);
    const { data, error } = await this.supabase
      .from("listings")
      .select(`*, collections(name, symbol, floor_price)`)
      .eq("is_active", true)
      .eq("chain_id", chain);

    if (error) throw error;
    return data;
  }

  async upsert(listing: ListingInsert): Promise<void> {
    const payload = this.normalizeInsert(listing);
    const { error } = await this.supabase
      .from("listings")
      .upsert(payload, {
        onConflict: "chain_id,collection_address,token_id",
        ignoreDuplicates: false,
      });

    if (error) throw error;
  }

  async update(
    chainId: number,
    collectionAddress: string,
    tokenId: string,
    updates: ListingUpdate,
  ): Promise<Listing> {
    const chain = normalizeChainId(chainId);
    const collection = normalizeCollectionAddress(collectionAddress);
    const token = normalizeTokenId(tokenId);
    const {
      listing_id: _listingId,
      chain_id: _chain,
      collection_address: _collection,
      token_id: _token,
      ...safeUpdates
    } = updates;
    const { data, error } = await this.supabase
      .from("listings")
      .update(safeUpdates)
      .eq("chain_id", chain)
      .eq("collection_address", collection)
      .eq("token_id", token)
      .select()
      .single();

    if (error) throw error;
    return data as Listing;
  }

  async deactivate(
    chainId: number,
    collectionAddress: string,
    tokenId: string,
    updates?: ListingUpdate,
  ): Promise<void> {
    const chain = normalizeChainId(chainId);
    const collection = normalizeCollectionAddress(collectionAddress);
    const token = normalizeTokenId(tokenId);
    const {
      listing_id: _listingId,
      chain_id: _chain,
      collection_address: _collection,
      token_id: _token,
      ...safeUpdates
    } = updates ?? {};
    const { error } = await this.supabase
      .from("listings")
      .update({ is_active: false, ...safeUpdates })
      .eq("chain_id", chain)
      .eq("collection_address", collection)
      .eq("token_id", token);

    if (error) throw error;
  }

  /** Optimistic write — used before on-chain confirmation */
  async insert(listing: ListingInsert): Promise<Listing> {
    const payload = this.normalizeInsert(listing);
    const { data, error } = await this.supabase
      .from("listings")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data as Listing;
  }

  async confirmByTxHash(txHash: string, chainId: number): Promise<void> {
    const chain = normalizeChainId(chainId);
    const { error } = await this.supabase
      .from("listings")
      .update({ status: "confirmed" })
      .eq("tx_hash", txHash.toLowerCase())
      .eq("chain_id", chain);

    if (error) throw error;
  }

  async failByTxHash(txHash: string, chainId: number): Promise<void> {
    const chain = normalizeChainId(chainId);
    const { error } = await this.supabase
      .from("listings")
      .update({ is_active: false, status: "failed" })
      .eq("tx_hash", txHash.toLowerCase())
      .eq("chain_id", chain);

    if (error) throw error;
  }

  private normalizeInsert(listing: ListingInsert): ListingInsert {
    const chainId = normalizeChainId(listing.chain_id);
    const collectionAddress = normalizeCollectionAddress(listing.collection_address);
    const tokenId = normalizeTokenId(listing.token_id);

    return {
      ...listing,
      listing_id: buildListingId(chainId, collectionAddress, tokenId),
      chain_id: chainId,
      collection_address: collectionAddress,
      token_id: tokenId,
    };
  }
}
