// Listing domain types

export interface Listing {
  id: string;
  listing_id: string | null;
  collection_address: string;
  token_id: string;
  seller_wallet: string | null;
  buyer_wallet: string | null;
  price: number;
  is_active: boolean;
  chain_id: number | null;
  listed_at: string | null;
  expires_at: string | null;
  tx_hash: string;
  created_at: string;
  updated_at: string | null;
  status?: string | null;
  source?: string | null;
}

export type ListingInsert = Omit<Listing, "id"> & { id?: string };
export type ListingUpdate = Partial<Listing>;
