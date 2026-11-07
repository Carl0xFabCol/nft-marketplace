import type { SupabaseClient } from "@supabase/supabase-js"
import { env } from "../config/env"
import { logger } from "../utils/logger"

// ═══════════════════════════════════════════════════════════════════════════════
// BIDS REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

/** The on-chain log that caused a bid state change. Orders events and keys idempotency. */
export interface BidEventPosition {
  blockNumber: bigint
  logIndex: number
  txHash: string
}

interface BidSlot {
  collectionAddress: string
  bidderWallet: string
}

/**
 * Repository for collection and token bids.
 *
 * IDX-6 / IDX-7 (migration 20261028091400): every bid state change goes
 * through one of two RPCs, scoped by chain_id and keyed on the event that
 * caused it:
 *   - a placement row is identified by (chain_id, tx_hash, log_index), so a
 *     replayed placement is a no-op;
 *   - closing a slot (new placement, cancel, acceptance) only touches bids
 *     placed BEFORE the event, so a replayed old event never closes a newer bid;
 *   - a collection bid's remaining quantity is placed_quantity minus the
 *     recorded fills (collection_bid_fills, keyed on the acceptance event),
 *     never "previous quantity - n".
 */
export class BidsRepository {
  constructor(
    private supabase: SupabaseClient,
    private chainId: number = env.chainId,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // COLLECTION BIDS
  // ───────────────────────────────────────────────────────────────────────────

  /** CollectionBidPlaced: closes earlier bids of the slot and records this one. */
  async placeCollectionBid(
    slot: BidSlot,
    position: BidEventPosition,
    at: Date,
    bid: { price: string; quantity: number; expiresAt: Date | null },
  ): Promise<number> {
    return this.applyCollectionBidEvent("placed", slot, position, at, {
      p_price_wei: bid.price,
      p_quantity: bid.quantity,
      p_expires_at: bid.expiresAt?.toISOString() ?? null,
    })
  }

  /** CollectionBidCancelled: closes the slot's bids placed before the event. */
  async cancelCollectionBid(slot: BidSlot, position: BidEventPosition, at: Date): Promise<number> {
    return this.applyCollectionBidEvent("cancelled", slot, position, at, {})
  }

  /** CollectionBidAccepted: records the fill once; remaining = placed - Σ fills. */
  async fillCollectionBid(slot: BidSlot, position: BidEventPosition, at: Date, tokenCount: number): Promise<number> {
    return this.applyCollectionBidEvent("filled", slot, position, at, { p_token_count: tokenCount })
  }

  private async applyCollectionBidEvent(
    kind: "placed" | "cancelled" | "filled",
    slot: BidSlot,
    position: BidEventPosition,
    at: Date,
    extra: Record<string, unknown>,
  ): Promise<number> {
    const args = {
      p_kind: kind,
      p_chain_id: this.chainId,
      p_collection_address: slot.collectionAddress.toLowerCase(),
      p_bidder_wallet: slot.bidderWallet.toLowerCase(),
      p_block_number: position.blockNumber.toString(),
      p_log_index: position.logIndex,
      p_tx_hash: position.txHash.toLowerCase(),
      p_at: at.toISOString(),
      ...extra,
    }
    const { data, error } = await this.supabase.rpc("indexer_apply_collection_bid_event", args)

    if (error) {
      logger.error({ error, args }, `❌ Failed to apply collection bid event (${kind})`)
      throw error
    }
    return Number(data ?? 0)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TOKEN BIDS
  // ───────────────────────────────────────────────────────────────────────────

  /** TokenBidPlaced: closes earlier bids of the slot and records this one. */
  async placeTokenBid(
    slot: BidSlot & { tokenId: string },
    position: BidEventPosition,
    at: Date,
    bid: { price: string; expiresAt: Date | null },
  ): Promise<number> {
    return this.applyTokenBidEvent("placed", slot, position, at, {
      p_price_wei: bid.price,
      p_expires_at: bid.expiresAt?.toISOString() ?? null,
    })
  }

  /** TokenBidAccepted / TokenBidCancelled: closes the slot's bids placed before the event. */
  async closeTokenBid(slot: BidSlot & { tokenId: string }, position: BidEventPosition, at: Date): Promise<number> {
    return this.applyTokenBidEvent("closed", slot, position, at, {})
  }

  private async applyTokenBidEvent(
    kind: "placed" | "closed",
    slot: BidSlot & { tokenId: string },
    position: BidEventPosition,
    at: Date,
    extra: Record<string, unknown>,
  ): Promise<number> {
    const args = {
      p_kind: kind,
      p_chain_id: this.chainId,
      p_collection_address: slot.collectionAddress.toLowerCase(),
      p_token_id: slot.tokenId,
      p_bidder_wallet: slot.bidderWallet.toLowerCase(),
      p_block_number: position.blockNumber.toString(),
      p_log_index: position.logIndex,
      p_tx_hash: position.txHash.toLowerCase(),
      p_at: at.toISOString(),
      ...extra,
    }
    const { data, error } = await this.supabase.rpc("indexer_apply_token_bid_event", args)

    if (error) {
      logger.error({ error, args }, `❌ Failed to apply token bid event (${kind})`)
      throw error
    }
    return Number(data ?? 0)
  }
}
