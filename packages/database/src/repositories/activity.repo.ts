import type { SupabaseClient } from "@supabase/supabase-js";
import type { Activity } from "@marketplace/shared";

// ─────────────────────────────────────────────────────────────────────────────
// ActivityRepository
// ─────────────────────────────────────────────────────────────────────────────

export type ActivityInsert = Omit<Activity, "id"> & { id?: string };

export class ActivityRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async insert(activity: ActivityInsert): Promise<void> {
    const { error } = await this.supabase.from("activity").insert({
      event: activity.event,
      collection_address: activity.collection_address?.toLowerCase(),
      token_id: activity.token_id,
      from: activity.from?.toLowerCase(),
      to: activity.to?.toLowerCase(),
      price: activity.price,
      quantity: activity.quantity,
      tx_hash: activity.tx_hash.toLowerCase(),
      created_at: activity.created_at,
      log_index: activity.log_index,
      source_contract: activity.source_contract,
    });

    if (error) throw error;
  }

  async getByUser(
    userAddress: string,
    options: { page?: number; limit?: number; chainId?: number } = {},
  ): Promise<Activity[]> {
    const { page = 1, limit = 24 } = options;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const addr = userAddress.toLowerCase();

    const { data, error } = await this.supabase
      .from("activity")
      .select("*")
      .or(`from.eq.${addr},to.eq.${addr}`)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;
    return (data ?? []) as Activity[];
  }

  async getByCollection(
    collectionAddress: string,
    options: { tokenId?: string; limit?: number } = {},
  ): Promise<Activity[]> {
    const { tokenId, limit = 50 } = options;

    let query = this.supabase
      .from("activity")
      .select("*")
      .eq("collection_address", collectionAddress.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(limit);

    if (tokenId) {
      query = query.eq("token_id", tokenId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Activity[];
  }
}
