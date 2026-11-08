import { Address } from "viem"
import type { IEventHandler } from "./IEventHandler"
import type { ParsedEvent } from "../types/indexer.types"
import type { MetadataFetcher } from "../fetchers/MetadataFetcher"
import { logger } from "../utils/logger"
import { toWeiString } from "../utils/wei"
import { requireContractAddresses } from "@marketplace/contracts"
import { env } from "../config/env"
import type { ActivityRepository } from "../persistence/ActivityRepository"
import type { BidEventPosition, BidsRepository } from "../persistence/BidsRepository"
import type { CollectionsRepository } from "../persistence/CollectionsRepository"
import type { ListingsRepository } from "../persistence/ListingsRepository"
import type { NFTRepository } from "../persistence/NFTRepository"

// Resolve the Bids contract address for whichever chain this process indexes.
const BIDS_CONTRACT_ADDRESS = requireContractAddresses(env.chainId).MARKETPLACE_BIDS

// ═══════════════════════════════════════════════════════════════════════════════
// BIDS CONTRACT EVENT HANDLERS - FULLY REFACTORED WITH REPOSITORIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Base class for Bids contract event handlers.
 * Provides shared utilities and dependencies via repositories.
 */
abstract class BaseBidsHandler<TArgs = Record<string, unknown>> implements IEventHandler<TArgs> {
  readonly contractName = "bids"
  abstract readonly eventName: string

  constructor(
    protected activityRepo: ActivityRepository,
    protected bidsRepo: BidsRepository,
    protected collectionsRepo: CollectionsRepository,
    protected listingsRepo: ListingsRepository,
    protected nftRepo: NFTRepository,
    protected metadataFetcher: MetadataFetcher,
  ) {}

  abstract handle(event: ParsedEvent<TArgs>): Promise<void>

  /** The log that caused this bid change: orders bid events and keys their idempotency (IDX-7). */
  protected position(event: ParsedEvent<TArgs>): BidEventPosition {
    return { blockNumber: event.blockNumber, logIndex: event.logIndex, txHash: String(event.transactionHash) }
  }

  /**
   * Helper: Insert activity record via repository
   */
  protected async insertActivity(params: {
    event: string
    collectionAddress: string
    tokenId?: string
    from?: string
    to?: string
    price?: string
    quantity?: number
    txHash: string
    createdAt: Date
    logIndex: number
    sourceContract: string
  }): Promise<boolean> {
    return await this.activityRepo.insert(params)
  }

  /**
   * Helper: Update NFT owner via repository
   */
  protected async updateNFTOwner(collectionAddress: string, tokenId: string, ownerWallet: string, timestamp: number): Promise<void> {
    try {
      await this.nftRepo.updateOwner(collectionAddress, tokenId, ownerWallet, new Date(timestamp * 1000))
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          collectionAddress,
          tokenId,
          ownerWallet,
        },
        "⚠️ NFT owner update failed, continuing...",
      )
    }
  }

  /**
   * Helper: Upsert NFT with metadata via repository
   */
  protected async upsertNFT(collectionAddress: string, tokenId: string, ownerWallet: string, timestamp: number): Promise<void> {
    try {
      const nftData = await this.metadataFetcher.getNFTData(collectionAddress as Address, tokenId)

      await this.nftRepo.upsert({
        collectionAddress: collectionAddress.toLowerCase(),
        tokenId,
        ownerWallet: ownerWallet.toLowerCase(),
        lastSynced: new Date(timestamp * 1000),
        chainId: env.chainId,
        tokenUri: nftData.tokenUri,
        imageUrl: nftData.imageUrl,
        metadata: nftData.metadata,
      })
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          collectionAddress,
          tokenId,
        },
        "⚠️  NFT upsert encountered error, continuing...",
      )
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// COLLECTION BID EVENTS
// ───────────────────────────────────────────────────────────────────────────────

interface CollectionBidPlacedArgs {
  collection: Address
  bidder: Address
  pricePerItem: bigint
  quantity: bigint
  expiresAt: bigint
}

export class CollectionBidPlacedHandler extends BaseBidsHandler<CollectionBidPlacedArgs> {
  readonly eventName = "CollectionBidPlaced"

  async handle(event: ParsedEvent<CollectionBidPlacedArgs>): Promise<void> {
    const { collection, bidder, pricePerItem, quantity, expiresAt } = event.args

    logger.info(
      {
        collection,
        bidder,
        pricePerItem: pricePerItem.toString(),
        quantity: quantity.toString(),
        blockNumber: event.blockNumber.toString(),
      },
      "💰 Handling CollectionBidPlaced",
    )

    // The new placement overwrites the on-chain slot: earlier bids of this
    // (collection, bidder) close and this one is recorded, once (IDX-7).
    await this.bidsRepo.placeCollectionBid(
      { collectionAddress: String(collection), bidderWallet: String(bidder) },
      this.position(event),
      new Date(event.blockTimestamp * 1000),
      {
        price: toWeiString(pricePerItem),
        quantity: Number(quantity),
        expiresAt: expiresAt && Number(expiresAt) > 0 ? new Date(Number(expiresAt) * 1000) : null,
      },
    )

    await this.insertActivity({
      event: "COLLECTION_BID_PLACED",
      collectionAddress: String(collection).toLowerCase(),
      to: String(bidder).toLowerCase(),
      price: pricePerItem.toString(),
      quantity: Number(quantity),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

interface CollectionBidAcceptedArgs {
  collection: Address
  bidder: Address
  seller: Address
  tokenIds: bigint[]
  totalPrice: bigint
}

export class CollectionBidAcceptedHandler extends BaseBidsHandler<CollectionBidAcceptedArgs> {
  readonly eventName = "CollectionBidAccepted"

  async handle(event: ParsedEvent<CollectionBidAcceptedArgs>): Promise<void> {
    const { collection, bidder, seller, tokenIds, totalPrice } = event.args

    logger.info(
      {
        collection,
        bidder,
        seller,
        tokenCount: tokenIds.length,
        totalPrice: totalPrice.toString(),
        blockNumber: event.blockNumber.toString(),
      },
      "✅ Handling CollectionBidAccepted",
    )

    // IDX-7: record this fill once (keyed on the event); the remaining
    // quantity is placed_quantity minus the recorded fills, not the previous
    // DB value minus tokenIds.length, so a replay cannot decrement twice.
    await this.bidsRepo.fillCollectionBid(
      { collectionAddress: String(collection), bidderWallet: String(bidder) },
      this.position(event),
      new Date(event.blockTimestamp * 1000),
      tokenIds.length,
    )

    // Update NFT owners for all tokens
    for (const tokenId of tokenIds) {
      await this.updateNFTOwner(String(collection).toLowerCase(), tokenId.toString(), String(bidder).toLowerCase(), event.blockTimestamp)
      // Cancel any active listings for this token
      await this.listingsRepo.deactivate(String(collection).toLowerCase(), tokenId.toString(), new Date(event.blockTimestamp * 1000))
    }

    await this.insertActivity({
      event: "COLLECTION_BID_ACCEPTED",
      collectionAddress: String(collection).toLowerCase(),
      from: String(seller).toLowerCase(),
      to: String(bidder).toLowerCase(),
      price: totalPrice.toString(),
      quantity: tokenIds.length,
      txHash: String(event.transactionHash).toLowerCase(),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })

    // IDX-1: no stats here. Core emits one Sale per tokenId inside this same
    // acceptance (executeSaleFromBid), and SaleHandler is the only source of
    // collection volume/sales.
  }
}

interface CollectionBidCancelledArgs {
  collection: Address
  bidder: Address
}

export class CollectionBidCancelledHandler extends BaseBidsHandler<CollectionBidCancelledArgs> {
  readonly eventName = "CollectionBidCancelled"

  async handle(event: ParsedEvent<CollectionBidCancelledArgs>): Promise<void> {
    const { collection, bidder } = event.args

    logger.info(
      {
        collection,
        bidder,
        blockNumber: event.blockNumber.toString(),
      },
      "❌ Handling CollectionBidCancelled",
    )

    await this.bidsRepo.cancelCollectionBid(
      { collectionAddress: String(collection), bidderWallet: String(bidder) },
      this.position(event),
      new Date(event.blockTimestamp * 1000),
    )

    await this.insertActivity({
      event: "COLLECTION_BID_CANCELLED",
      collectionAddress: String(collection).toLowerCase(),
      to: String(bidder).toLowerCase(),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// TOKEN BID EVENTS
// ───────────────────────────────────────────────────────────────────────────────

interface TokenBidPlacedArgs {
  collection: Address
  tokenId: bigint
  bidder: Address
  price: bigint
  expiresAt: bigint
}

export class TokenBidPlacedHandler extends BaseBidsHandler<TokenBidPlacedArgs> {
  readonly eventName = "TokenBidPlaced"

  async handle(event: ParsedEvent<TokenBidPlacedArgs>): Promise<void> {
    const { collection, tokenId, bidder, price, expiresAt } = event.args

    logger.info(
      {
        collection,
        tokenId: tokenId.toString(),
        bidder,
        price: price.toString(),
        blockNumber: event.blockNumber.toString(),
      },
      "💎 Handling TokenBidPlaced",
    )

    // The new placement overwrites the on-chain slot: earlier bids of this
    // (collection, tokenId, bidder) close and this one is recorded, once (IDX-7).
    await this.bidsRepo.placeTokenBid(
      { collectionAddress: String(collection), tokenId: tokenId.toString(), bidderWallet: String(bidder) },
      this.position(event),
      new Date(event.blockTimestamp * 1000),
      {
        price: toWeiString(price),
        expiresAt: expiresAt && Number(expiresAt) > 0 ? new Date(Number(expiresAt) * 1000) : null,
      },
    )

    await this.insertActivity({
      event: "TOKEN_BID_PLACED",
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId.toString(),
      to: String(bidder).toLowerCase(),
      price: price.toString(),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

interface TokenBidAcceptedArgs {
  collection: Address
  tokenId: bigint
  bidder: Address
  seller: Address
  price: bigint
}

export class TokenBidAcceptedHandler extends BaseBidsHandler<TokenBidAcceptedArgs> {
  readonly eventName = "TokenBidAccepted"

  async handle(event: ParsedEvent<TokenBidAcceptedArgs>): Promise<void> {
    const { collection, tokenId, bidder, seller, price } = event.args

    logger.info(
      {
        collection,
        tokenId: tokenId.toString(),
        bidder,
        seller,
        price: price.toString(),
        blockNumber: event.blockNumber.toString(),
      },
      "✅ Handling TokenBidAccepted",
    )

    // Close the accepted bid (only bids placed before this event)
    await this.bidsRepo.closeTokenBid(
      { collectionAddress: String(collection), tokenId: tokenId.toString(), bidderWallet: String(bidder) },
      this.position(event),
      new Date(event.blockTimestamp * 1000),
    )

    // Cancel any active listing for this token
    await this.listingsRepo.deactivate(String(collection).toLowerCase(), tokenId.toString(), new Date(event.blockTimestamp * 1000))

    // Update NFT owner
    await this.updateNFTOwner(String(collection).toLowerCase(), tokenId.toString(), String(bidder).toLowerCase(), event.blockTimestamp)
    await this.insertActivity({
      event: "TOKEN_BID_ACCEPTED",
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId.toString(),
      from: String(seller).toLowerCase(),
      to: String(bidder).toLowerCase(),
      price: price.toString(),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })

    // IDX-1: no stats here. Core emits Sale in this same acceptance
    // (executeSaleFromBid), and SaleHandler is the only source of collection
    // volume/sales.
  }
}

interface TokenBidCancelledArgs {
  collection: Address
  tokenId: bigint
  bidder: Address
}

export class TokenBidCancelledHandler extends BaseBidsHandler<TokenBidCancelledArgs> {
  readonly eventName = "TokenBidCancelled"

  async handle(event: ParsedEvent<TokenBidCancelledArgs>): Promise<void> {
    const { collection, tokenId, bidder } = event.args

    logger.info(
      {
        collection,
        tokenId: tokenId.toString(),
        bidder,
        blockNumber: event.blockNumber.toString(),
      },
      "❌ Handling TokenBidCancelled",
    )

    await this.bidsRepo.closeTokenBid(
      { collectionAddress: String(collection), tokenId: tokenId.toString(), bidderWallet: String(bidder) },
      this.position(event),
      new Date(event.blockTimestamp * 1000),
    )

    await this.insertActivity({
      event: "TOKEN_BID_CANCELLED",
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId.toString(),
      to: String(bidder).toLowerCase(),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// PROCEEDS
// ───────────────────────────────────────────────────────────────────────────────

interface WithdrawalArgs {
  account: Address
  amount: bigint
}

/** Proceeds pulled from the Bids contract. Activity row only (no balances table). */
export class BidsWithdrawalHandler extends BaseBidsHandler<WithdrawalArgs> {
  readonly eventName = "Withdrawal"

  async handle(event: ParsedEvent<WithdrawalArgs>): Promise<void> {
    const { account, amount } = event.args

    logger.info({ account, amount: amount.toString(), blockNumber: event.blockNumber.toString() }, "💸 Handling Bids Withdrawal")

    await this.insertActivity({
      event: "WITHDRAWAL",
      collectionAddress: BIDS_CONTRACT_ADDRESS.toLowerCase(),
      to: String(account).toLowerCase(),
      price: toWeiString(amount),
      txHash: String(event.transactionHash).toLowerCase(),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// ADMIN EVENTS
// ───────────────────────────────────────────────────────────────────────────────

export class BidsPausedHandler extends BaseBidsHandler {
  readonly eventName = "Paused"

  async handle(event: ParsedEvent): Promise<void> {
    logger.info({ blockNumber: event.blockNumber.toString() }, "⏸️  Handling Bids Contract Paused")

    await this.insertActivity({
      event: "PAUSED",
      collectionAddress: BIDS_CONTRACT_ADDRESS.toLowerCase(),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

export class BidsUnpausedHandler extends BaseBidsHandler {
  readonly eventName = "Unpaused"

  async handle(event: ParsedEvent): Promise<void> {
    logger.info({ blockNumber: event.blockNumber.toString() }, "▶️  Handling Bids Contract Unpaused")

    await this.insertActivity({
      event: "UNPAUSED",
      collectionAddress: BIDS_CONTRACT_ADDRESS.toLowerCase(),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create all Bids event handlers with repository dependencies.
 * Factory function to instantiate all handlers with clean dependency injection.
 */
export function createBidsEventHandlers(
  activityRepo: ActivityRepository,
  bidsRepo: BidsRepository,
  collectionsRepo: CollectionsRepository,
  listingsRepo: ListingsRepository,
  nftRepo: NFTRepository,
  metadataFetcher: MetadataFetcher,
): IEventHandler<any>[] {
  return [
    new CollectionBidPlacedHandler(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new CollectionBidAcceptedHandler(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new CollectionBidCancelledHandler(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new TokenBidPlacedHandler(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new TokenBidAcceptedHandler(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new TokenBidCancelledHandler(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new BidsWithdrawalHandler(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new BidsPausedHandler(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new BidsUnpausedHandler(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
  ]
}
