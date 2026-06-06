// Activity / event feed types

export type ActivityEventType =
  | "LISTING_CREATED"
  | "LISTING_UPDATED"
  | "LISTING_CANCELLED"
  | "SALE"
  | "TOKEN_BID_PLACED"
  | "TOKEN_BID_ACCEPTED"
  | "TOKEN_BID_CANCELLED"
  | "COLLECTION_BID_PLACED"
  | "COLLECTION_BID_ACCEPTED"
  | "COLLECTION_BID_CANCELLED"
  | "COLLECTION_REGISTERED"
  | "COLLECTION_VERIFIED"
  | "TRANSFER"
  | "PAUSED"
  | "UNPAUSED"
  | "MARKETPLACE_FEE_UPDATED"
  | "FEE_RECEIVER_UPDATED"
  | "OWNERSHIP_TRANSFERRED"
  | "CONTRACT_AUTHORIZED"
  | string; // allow unknown future events

export interface Activity {
  id: string;
  event: ActivityEventType | null;
  collection_address: string | null;
  token_id: string | null;
  from: string | null;
  to: string | null;
  price: string | null;
  quantity: number | null;
  tx_hash: string;
  log_index: number | null;
  source_contract: string | null;
  owner_wallet: string | null;
  created_at: string | null;
}
