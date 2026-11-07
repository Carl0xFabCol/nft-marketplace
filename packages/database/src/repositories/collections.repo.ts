import type { SupabaseClient } from "@supabase/supabase-js";
import type { Collection } from "@marketplace/shared";
import { DEFAULT_CHAIN_ID, ZERO_ADDRESS } from "@marketplace/shared/constants";

// ─────────────────────────────────────────────────────────────────────────────
// CollectionsRepository
// ─────────────────────────────────────────────────────────────────────────────

export class CollectionsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getByAddress(
    contractAddress: string,
    chainId = DEFAULT_CHAIN_ID,
  ): Promise<Collection | null> {
    const { data, error } = await this.supabase
      .from("collections")
      .select(`*, nfts(count)`)
      .eq("contract_address", contractAddress.toLowerCase())
      .eq("chain_id", chainId)
      .neq("nfts.owner_wallet", ZERO_ADDRESS)
      .single();

    if (error) return null;
    return {
      ...data,
      nft_count: (data as any).nfts?.[0]?.count ?? 0,
      nfts: undefined,
    } as Collection;
  }

  async getAll(
    options: {
      page?: number;
      limit?: number;
      sortBy?: "volume" | "sales" | "name" | "created";
      sortDir?: "asc" | "desc";
      verified?: boolean;
      search?: string;
      chainId?: number;
    } = {},
  ) {
    const {
      page = 1,
      limit = 20,
      sortBy = "volume",
      sortDir = "desc",
      verified,
      search,
      chainId = DEFAULT_CHAIN_ID,
    } = options;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = this.supabase
      .from("collections")
      .select(`*, nfts(count)`, { count: "exact" })
      .eq("chain_id", chainId)
      .neq("nfts.owner_wallet", ZERO_ADDRESS);

    if (verified !== undefined) query = query.eq("is_verified", verified);
    if (search) {
      query = query.or(
        `name.ilike.%${search}%,symbol.ilike.%${search}%,contract_address.ilike.%${search}%`,
      );
    }

    const sortCol =
      sortBy === "volume"
        ? "total_volume"
        : sortBy === "sales"
          ? "total_sales"
          : sortBy === "name"
            ? "name"
            : "created_at";

    query = query.order(sortCol, {
      ascending: sortDir === "asc",
      nullsFirst: false,
    });

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;

    const collections = (data ?? []).map((col: any) => ({
      ...col,
      nft_count: col.nfts?.[0]?.count ?? 0,
      nfts: undefined,
    }));

    return {
      collections,
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    };
  }

  async upsert(
    collection: Partial<Collection> & { contract_address: string },
  ): Promise<void> {
    const { error } = await this.supabase
      .from("collections")
      // M-2: identity is (chain_id, contract_address); callers must pass chain_id.
      .upsert(collection, { onConflict: "chain_id,contract_address" });

    if (error) throw error;
  }

  async update(
    contractAddress: string,
    updates: Partial<Collection>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("collections")
      .update(updates)
      .eq("contract_address", contractAddress.toLowerCase());

    if (error) throw error;
  }

  /**
   * M-5: increment_collection_stats is chain-scoped (p_chain_id first) and
   * service_role-only. `volume` is an exact ether decimal string (e.g.
   * "1.234567890123456789"), never a JS number. The indexer records sales
   * through indexer_record_sale instead; this is for manual reconciliation.
   */
  async incrementStats(
    chainId: number,
    contractAddress: string,
    volume: string,
    sales: number,
  ): Promise<void> {
    const { error } = await this.supabase.rpc("increment_collection_stats", {
      p_chain_id: chainId,
      p_collection_address: contractAddress.toLowerCase(),
      p_volume: volume,
      p_sales: sales,
    });

    if (error) throw error;
  }

}
