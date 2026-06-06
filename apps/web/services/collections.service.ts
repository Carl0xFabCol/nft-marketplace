// services/collection.service.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { Address } from "viem";

export interface Collection {
  id: string;
  contract_address: Address;
  chain_id: number;
  name: string | null;
  symbol: string | null;
  description: string | null;
  image_url: string | null;
  creator_wallet: string | null;
  created_at: string | null;
  deployed_at: number | null;
  indexer_block: number | null;
  total_volume: number | null;
  total_sales: number | null;
  floor_price: string | null; // wei as string — use formatEther() to display
  updated_at: string | null;
  is_verified: boolean | null;
  royalty_fee: number | null;
  nft_count?: number;
  owner_count?: number;
  top_bid: any;
}

export interface CollectionStats {
  floor_price: string;
  total_volume: number;
  total_sales: number;
  nft_count: number;
  owner_count: number;
  avg_price: number;
  market_cap: number;
}

// ─── helpers ────────────────────────────────────────────────────────────────

import { DEFAULT_CHAIN_ID, ZERO_ADDRESS } from "@marketplace/shared";
const ZERO = ZERO_ADDRESS;
const DEFAULT_CHAIN = DEFAULT_CHAIN_ID;

// ─── CollectionService ──────────────────────────────────────────────────────

export class CollectionService {
  /**
   * Colecciones con paginación.
   * Resuelve el N+1 de nft_count con un COUNT agregado en una sola query.
   */
  static async getCollections(
    supabase: SupabaseClient,
    options?: {
      page?: number;
      limit?: number;
      sortBy?: "volume" | "sales" | "name" | "created";
      sortDir?: "asc" | "desc";
      verified?: boolean;
      search?: string;
      chainId?: number;
    },
  ) {
    const {
      page = 1,
      limit = 20,
      sortBy = "volume",
      sortDir = "desc",
      verified,
      search,
      chainId = DEFAULT_CHAIN,
    } = options || {};

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Una sola query — nft_count viene del aggregate de Supabase
    let query = supabase
      .from("collections")
      .select(`*, nfts(count)`, { count: "exact" })
      .eq("chain_id", chainId)
      .neq("nfts.owner_wallet", ZERO);

    if (verified !== undefined) query = query.eq("is_verified", verified);
    if (search) {
      query = query.or(
        `name.ilike.%${search}%,symbol.ilike.%${search}%,contract_address.ilike.%${search}%`,
      );
    }

    const sortColumn =
      sortBy === "volume"
        ? "total_volume"
        : sortBy === "sales"
          ? "total_sales"
          : sortBy === "name"
            ? "name"
            : "created_at";

    query = query.order(sortColumn, {
      ascending: sortDir === "asc",
      nullsFirst: false,
    });

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;

    const collections = (data || []).map((col: any) => ({
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

  /**
   * Colección por dirección.
   */
  static async getCollectionByAddress(
    supabase: SupabaseClient,
    contractAddress: Address,
    chainId = DEFAULT_CHAIN,
  ) {
    const { data, error } = await supabase
      .from("collections")
      .select(`*, nfts(count)`)
      .eq("contract_address", contractAddress.toLowerCase())
      .eq("chain_id", chainId)
      .neq("nfts.owner_wallet", ZERO)
      .single();

    if (error) throw error;

    return {
      ...data,
      nft_count: (data as any).nfts?.[0]?.count ?? 0,
      nfts: undefined,
    };
  }

  /**
   * Top N colecciones por volumen.
   */
  static async getTopCollectionsByVolume(
    supabase: SupabaseClient,
    limit = 10,
    chainId = DEFAULT_CHAIN,
  ) {
    const { data, error } = await supabase
      .from("collections")
      .select(`*, nfts(count)`)
      .eq("chain_id", chainId)
      .not("total_volume", "is", null)
      .order("total_volume", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw error;
    return (data || []).map((col: any) => ({
      ...col,
      nft_count: col.nfts?.[0]?.count ?? 0,
      nfts: undefined,
    }));
  }

  /**
   * Top N colecciones por ventas.
   */
  static async getTopCollectionsBySales(
    supabase: SupabaseClient,
    limit = 10,
    chainId = DEFAULT_CHAIN,
  ) {
    const { data, error } = await supabase
      .from("collections")
      .select(`*, nfts(count)`)
      .eq("chain_id", chainId)
      .not("total_sales", "is", null)
      .order("total_sales", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw error;
    return (data || []).map((col: any) => ({
      ...col,
      nft_count: col.nfts?.[0]?.count ?? 0,
      nfts: undefined,
    }));
  }

  /**
   * Colecciones verificadas.
   */
  static async getVerifiedCollections(
    supabase: SupabaseClient,
    limit?: number,
    chainId = DEFAULT_CHAIN,
  ) {
    let query = supabase
      .from("collections")
      .select(`*, nfts(count)`)
      .eq("chain_id", chainId)
      .eq("is_verified", true)
      .order("total_volume", { ascending: false, nullsFirst: false });

    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((col: any) => ({
      ...col,
      nft_count: col.nfts?.[0]?.count ?? 0,
      nfts: undefined,
    }));
  }

  /**
   * Colecciones recientes.
   */
  static async getRecentCollections(
    supabase: SupabaseClient,
    limit = 10,
    chainId = DEFAULT_CHAIN,
  ) {
    const { data, error } = await supabase
      .from("collections")
      .select(`*, nfts(count)`)
      .eq("chain_id", chainId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []).map((col: any) => ({
      ...col,
      nft_count: col.nfts?.[0]?.count ?? 0,
      nfts: undefined,
    }));
  }

  /**
   * Estadísticas detalladas de una colección.
   * floor_price ya viene de la columna de collections (mantenida por trigger).
   * owner_count se calcula con COUNT DISTINCT en una sola query.
   */
  static async getCollectionStats(
    supabase: SupabaseClient,
    contractAddress: Address,
    chainId = DEFAULT_CHAIN,
  ): Promise<CollectionStats | null> {
    try {
      const [collectionRes, nftStatsRes, avgPriceRes] =
        await Promise.allSettled([
          // Datos de colección (floor_price viene del trigger)
          supabase
            .from("collections")
            .select("total_volume, total_sales, floor_price")
            .eq("contract_address", contractAddress.toLowerCase())
            .eq("chain_id", chainId)
            .single(),

          // nft_count + owner_count en una sola query
          supabase.rpc("get_collection_nft_stats", {
            p_collection_address: contractAddress.toLowerCase(),
            p_chain_id: chainId,
          }),

          // Precio promedio de las últimas 100 ventas
          supabase
            .from("activity")
            .select("price")
            .eq("collection_address", contractAddress.toLowerCase())
            .eq("event", "SALE")
            .order("created_at", { ascending: false })
            .limit(100),
        ]);

      if (collectionRes.status === "rejected") return null;
      const collection = collectionRes.value.data;
      if (!collection) return null;

      const nftStats =
        nftStatsRes.status === "fulfilled"
          ? (nftStatsRes.value.data as any)
          : { nft_count: 0, owner_count: 0 };

      const sales =
        avgPriceRes.status === "fulfilled" ? avgPriceRes.value.data || [] : [];

      const avgPrice =
        sales.length > 0
          ? sales.reduce(
              (acc: number, s: any) => acc + (Number(s.price) || 0),
              0,
            ) / sales.length
          : 0;

      const floorPrice = Number(collection.floor_price) || 0;
      const nftCount = nftStats?.nft_count ?? 0;

      return {
        floor_price: collection.floor_price?.toString() ?? "0",
        total_volume: collection.total_volume ?? 0,
        total_sales: collection.total_sales ?? 0,
        nft_count: nftCount,
        owner_count: nftStats?.owner_count ?? 0,
        avg_price: avgPrice,
        market_cap: floorPrice * nftCount,
      };
    } catch (error) {
      console.error("Error getting collection stats:", error);
      return null;
    }
  }

  /**
   * Estadísticas de múltiples colecciones — usa floor_price de la DB
   * en lugar de calcularla en JS desde listings.
   */
  static async getMultipleCollectionsStats(
    supabase: SupabaseClient,
    contractAddresses: Address[],
  ) {
    if (contractAddresses.length === 0) return { floors: {}, topBids: {} };

    const addresses = contractAddresses.map((a) => a.toLowerCase());

    // floor_price ya está en collections, no necesitamos tocar listings
    const [collectionsRes, topBidsRes] = await Promise.allSettled([
      supabase
        .from("collections")
        .select("contract_address, floor_price")
        .in("contract_address", addresses),

      supabase
        .from("collection_bids")
        .select("collection_address, price")
        .eq("is_active", true)
        .in("collection_address", addresses)
        .order("price", { ascending: false }),
    ]);

    const floorMap: Record<string, string> = {};
    if (collectionsRes.status === "fulfilled") {
      collectionsRes.value.data?.forEach((col: any) => {
        if (col.floor_price != null) {
          floorMap[col.contract_address] = String(col.floor_price);
        }
      });
    }

    const topBidMap: Record<string, string> = {};
    if (topBidsRes.status === "fulfilled") {
      topBidsRes.value.data?.forEach((bid: any) => {
        // .order(desc) garantiza que el primero por address es el mayor
        if (!topBidMap[bid.collection_address]) {
          topBidMap[bid.collection_address] = String(bid.price);
        }
      });
    }

    return { floors: floorMap, topBids: topBidMap };
  }

  /**
   * Colecciones con top bid incluido.
   * Resuelve el N+1 trayendo todos los top bids en una sola query.
   */
  static async getCollectionsWithTopBids(
    supabase: SupabaseClient,
    options?: { page?: number; limit?: number; chainId?: number },
  ) {
    const { page = 1, limit = 20, chainId = DEFAULT_CHAIN } = options || {};

    const collectionsResult = await this.getCollections(supabase, {
      page,
      limit,
      chainId,
      sortBy: "volume",
    });
    if (collectionsResult.collections.length === 0)
      return { ...collectionsResult, collections: [] };

    const addresses = collectionsResult.collections.map((c: any) =>
      c.contract_address.toLowerCase(),
    );

    // Un solo fetch para todos los top bids
    const { data: bids } = await supabase
      .from("collection_bids")
      .select("collection_address, price, bidder_wallet, created_at")
      .eq("is_active", true)
      .in("collection_address", addresses)
      .order("price", { ascending: false });

    // Construir mapa: solo el bid más alto por colección
    const topBidMap = new Map<string, any>();
    bids?.forEach((bid) => {
      if (!topBidMap.has(String(bid.collection_address))) {
        topBidMap.set(String(bid.collection_address), bid);
      }
    });

    return {
      ...collectionsResult,
      collections: collectionsResult.collections.map((col: any) => {
        return {
          ...col,
          top_bid:
            topBidMap.get(col.contract_address.toLowerCase()) ?? undefined,
        };
      }),
    };
  }

  /**
   * Colecciones con más holders.
   * Usa COUNT DISTINCT en DB en lugar de traer todos los NFTs a JS.
   */
  static async getCollectionsByHolders(
    supabase: SupabaseClient,
    limit = 10,
    chainId = DEFAULT_CHAIN,
  ) {
    const { data, error } = await supabase.rpc("get_collections_by_holders", {
      p_chain_id: chainId,
      p_limit: limit,
    });

    if (error) throw error;
    return data || [];
  }

  /**
   * Top 5 colecciones por volumen en las últimas 24h.
   */
  static async getTopCollectionsByVolume24h(
    supabase: SupabaseClient,
    chainId = DEFAULT_CHAIN,
  ) {
    try {
      const { data: volumeData, error } = await (supabase.rpc as any)(
        "get_top_collections_volume_24h",
      );
      console.log(volumeData);

      if (error) throw error;
      if (!volumeData?.length) return [];

      const addresses = volumeData.map((i: any) => i.collection_address);

      const { data: collections, error: colErr } = await supabase
        .from("collections")
        .select(`*, nfts(count)`)
        .in("contract_address", addresses)
        .eq("chain_id", chainId);

      if (colErr) throw colErr;
      return volumeData.map((vol: any, idx: number) => {
        const col = collections?.find(
          (c: any) =>
            c.contract_address.toLowerCase() ===
            vol.collection_address.toLowerCase(),
        );
        return {
          ...col,
          nft_count: (col as any)?.nfts?.[0]?.count ?? 0,
          nfts: undefined,
          volume_24h: vol.total_volume ?? 0,
          sales_24h: vol.total_sales ?? 0,
          rank: idx + 1,
        };
      });
    } catch (error) {
      console.error("Error getting top collections by 24h volume:", error);
      return [];
    }
  }

  /**
   * Buscar colecciones.
   */
  static async searchCollections(
    supabase: SupabaseClient,
    query: string,
    limit = 10,
    chainId = DEFAULT_CHAIN,
  ) {
    const { data, error } = await supabase
      .from("collections")
      .select(`*, nfts(count)`)
      .eq("chain_id", chainId)
      .or(
        `name.ilike.%${query}%,symbol.ilike.%${query}%,contract_address.ilike.%${query}%`,
      )
      .order("total_volume", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw error;
    return (data || []).map((col: any) => ({
      ...col,
      nft_count: col.nfts?.[0]?.count ?? 0,
      nfts: undefined,
    }));
  }

  /**
   * Top bid de una colección.
   */
  static async getCollectionTopBid(
    supabase: SupabaseClient,
    contractAddress: Address,
  ) {
    const { data, error } = await supabase
      .from("collection_bids")
      .select("*")
      .eq("collection_address", contractAddress.toLowerCase())
      .eq("is_active", true)
      .order("price", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  }
}
