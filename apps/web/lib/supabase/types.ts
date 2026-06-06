export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity: {
        Row: {
          collection_address: string | null
          created_at: string | null
          event: string | null
          from: string | null
          id: string
          log_index: number | null
          owner_wallet: string | null
          price: string | null
          quantity: number | null
          source_contract: string | null
          to: string | null
          token_id: string | null
          tx_hash: string
        }
        Insert: {
          collection_address?: string | null
          created_at?: string | null
          event?: string | null
          from?: string | null
          id?: string
          log_index?: number | null
          owner_wallet?: string | null
          price?: string | null
          quantity?: number | null
          source_contract?: string | null
          to?: string | null
          token_id?: string | null
          tx_hash: string
        }
        Update: {
          collection_address?: string | null
          created_at?: string | null
          event?: string | null
          from?: string | null
          id?: string
          log_index?: number | null
          owner_wallet?: string | null
          price?: string | null
          quantity?: number | null
          source_contract?: string | null
          to?: string | null
          token_id?: string | null
          tx_hash?: string
        }
        Relationships: []
      }
      collection_bids: {
        Row: {
          bidder_wallet: string
          collection_address: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean | null
          price: number | null
          quantity: number | null
          seller_wallet: string | null
          updated_at: string | null
        }
        Insert: {
          bidder_wallet: string
          collection_address?: string | null
          created_at: string
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          price?: number | null
          quantity?: number | null
          seller_wallet?: string | null
          updated_at?: string | null
        }
        Update: {
          bidder_wallet?: string
          collection_address?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          price?: number | null
          quantity?: number | null
          seller_wallet?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_bids_collection_address_fkey"
            columns: ["collection_address"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["contract_address"]
          },
        ]
      }
      collections: {
        Row: {
          chain_id: number
          contract_address: string
          created_at: string | null
          creator_wallet: string | null
          deployed_at: number | null
          description: string | null
          floor_price: number | null
          id: string
          image_url: string | null
          indexer_block: number | null
          is_verified: boolean | null
          name: string | null
          royalty_fee: number | null
          symbol: string | null
          total_sales: number | null
          total_volume: number | null
          updated_at: string | null
        }
        Insert: {
          chain_id: number
          contract_address: string
          created_at?: string | null
          creator_wallet?: string | null
          deployed_at?: number | null
          description?: string | null
          floor_price?: number | null
          id?: string
          image_url?: string | null
          indexer_block?: number | null
          is_verified?: boolean | null
          name?: string | null
          royalty_fee?: number | null
          symbol?: string | null
          total_sales?: number | null
          total_volume?: number | null
          updated_at?: string | null
        }
        Update: {
          chain_id?: number
          contract_address?: string
          created_at?: string | null
          creator_wallet?: string | null
          deployed_at?: number | null
          description?: string | null
          floor_price?: number | null
          id?: string
          image_url?: string | null
          indexer_block?: number | null
          is_verified?: boolean | null
          name?: string | null
          royalty_fee?: number | null
          symbol?: string | null
          total_sales?: number | null
          total_volume?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      contract_indexer_state: {
        Row: {
          contract_address: string
          contract_name: string
          last_block: number
          last_updated: string | null
        }
        Insert: {
          contract_address: string
          contract_name: string
          last_block?: number
          last_updated?: string | null
        }
        Update: {
          contract_address?: string
          contract_name?: string
          last_block?: number
          last_updated?: string | null
        }
        Relationships: []
      }
      indexer_state: {
        Row: {
          chain_id: number
          id: number
          last_block: number | null
        }
        Insert: {
          chain_id: number
          id?: number
          last_block?: number | null
        }
        Update: {
          chain_id?: number
          id?: number
          last_block?: number | null
        }
        Relationships: []
      }
      listings: {
        Row: {
          buyer_wallet: string | null
          chain_id: number | null
          collection_address: string
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          listed_at: string | null
          listing_id: string | null
          price: number
          seller_wallet: string | null
          token_id: string
          tx_hash: string
          updated_at: string | null
        }
        Insert: {
          buyer_wallet?: string | null
          chain_id?: number | null
          collection_address: string
          created_at: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          listed_at?: string | null
          listing_id?: string | null
          price: number
          seller_wallet?: string | null
          token_id: string
          tx_hash: string
          updated_at?: string | null
        }
        Update: {
          buyer_wallet?: string | null
          chain_id?: number | null
          collection_address?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          listed_at?: string | null
          listing_id?: string | null
          price?: number
          seller_wallet?: string | null
          token_id?: string
          tx_hash?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_nft_fk"
            columns: ["collection_address", "token_id", "chain_id"]
            isOneToOne: false
            referencedRelation: "nfts"
            referencedColumns: ["collection_address", "token_id", "chain_id"]
          },
          {
            foreignKeyName: "listings_nft_fk"
            columns: ["collection_address", "token_id", "chain_id"]
            isOneToOne: false
            referencedRelation: "nfts_market_view"
            referencedColumns: ["collection_address", "token_id", "chain_id"]
          },
        ]
      }
      nfts: {
        Row: {
          chain_id: number
          collection_address: string
          description: string | null
          id: string
          image_url: string | null
          last_synced: string | null
          metadata: Json | null
          minted_at: string | null
          name: string | null
          owner_wallet: string
          symbol: string | null
          token_id: string
          token_uri: string | null
        }
        Insert: {
          chain_id: number
          collection_address: string
          description?: string | null
          id?: string
          image_url?: string | null
          last_synced?: string | null
          metadata?: Json | null
          minted_at?: string | null
          name?: string | null
          owner_wallet: string
          symbol?: string | null
          token_id: string
          token_uri?: string | null
        }
        Update: {
          chain_id?: number
          collection_address?: string
          description?: string | null
          id?: string
          image_url?: string | null
          last_synced?: string | null
          metadata?: Json | null
          minted_at?: string | null
          name?: string | null
          owner_wallet?: string
          symbol?: string | null
          token_id?: string
          token_uri?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfts_collection_address_fkey"
            columns: ["collection_address"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["contract_address"]
          },
        ]
      }
      nonces: {
        Row: {
          created_at: string
          nonce: string
          used: boolean
        }
        Insert: {
          created_at?: string
          nonce: string
          used?: boolean
        }
        Update: {
          created_at?: string
          nonce?: string
          used?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          id: string
          username: string | null
          wallet: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          id: string
          username?: string | null
          wallet: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          id?: string
          username?: string | null
          wallet?: string
        }
        Relationships: []
      }
      token_bids: {
        Row: {
          bidder_wallet: string | null
          collection_address: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean | null
          price: number | null
          seller_wallet: string | null
          token_id: string | null
          updated_at: string | null
        }
        Insert: {
          bidder_wallet?: string | null
          collection_address?: string | null
          created_at: string
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          price?: number | null
          seller_wallet?: string | null
          token_id?: string | null
          updated_at?: string | null
        }
        Update: {
          bidder_wallet?: string | null
          collection_address?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          price?: number | null
          seller_wallet?: string | null
          token_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "token_bids_collection_address_fkey"
            columns: ["collection_address"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["contract_address"]
          },
        ]
      }
    }
    Views: {
      nfts_market_view: {
        Row: {
          best_collection_bid: number | null
          best_token_bid: number | null
          best_token_bidder: string | null
          chain_id: number | null
          collection_address: string | null
          id: string | null
          image_url: string | null
          listing_expires_at: string | null
          listing_id: string | null
          listing_price: number | null
          listing_seller: string | null
          metadata: Json | null
          name: string | null
          owner_wallet: string | null
          token_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfts_collection_address_fkey"
            columns: ["collection_address"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["contract_address"]
          },
        ]
      }
    }
    Functions: {
      cleanup_expired_collection_bids: { Args: never; Returns: number }
      cleanup_expired_listings: { Args: never; Returns: number }
      cleanup_expired_token_bids: { Args: never; Returns: number }
      expire_stale_records: { Args: never; Returns: undefined }
      get_activity_by_source: {
        Args: never
        Returns: {
          count: number
          source_contract: string
        }[]
      }
      get_collection_nft_stats: {
        Args: { p_chain_id?: number; p_collection_address: string }
        Returns: Json
      }
      get_collection_stats: {
        Args: { p_collection_address: string }
        Returns: {
          floor_price: string
          items_count: number
          listed_count: number
          owners_count: number
          total_sales: number
          total_volume: number
        }[]
      }
      get_collections_by_holders: {
        Args: { p_chain_id?: number; p_limit?: number }
        Returns: {
          contract_address: string
          owner_count: number
        }[]
      }
      get_top_collections: {
        Args: { p_limit?: number; p_order_by?: string }
        Returns: {
          contract_address: string
          floor_price: string
          is_verified: boolean
          name: string
          symbol: string
          total_sales: number
          total_volume: number
        }[]
      }
      get_top_collections_volume_24h: {
        Args: never
        Returns: {
          collection_address: string
          total_sales: number
          total_volume: number
        }[]
      }
      get_user_activity: {
        Args: { p_limit?: number; p_user_address: string }
        Returns: {
          collection_address: string
          collection_name: string
          created_at: string
          event: string
          price: string
          token_id: string
          tx_hash: string
        }[]
      }
      increment_collection_stats: {
        Args: {
          p_collection_address: string
          p_sales: number
          p_volume: number
        }
        Returns: undefined
      }
      update_collection_floor_price: {
        Args: { p_collection_address: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
