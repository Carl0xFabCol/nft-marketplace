// Bid domain types

export interface TokenBid {
  id: string;
  collection_address: string | null;
  token_id: string | null;
  bidder_wallet: string | null;
  seller_wallet: string | null;
  price: number | null;
  is_active: boolean | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CollectionBid {
  id: string;
  collection_address: string | null;
  bidder_wallet: string;
  seller_wallet: string | null;
  price: number | null;
  quantity: number | null;
  is_active: boolean | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string | null;
}
