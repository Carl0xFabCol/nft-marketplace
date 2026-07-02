import { Address } from "viem"
import type { IEventHandler } from "./IEventHandler"
import type { ParsedEvent } from "../types/indexer.types"
import type { MetadataFetcher } from "../fetchers/MetadataFetcher"
import { logger } from "../utils/logger"
import { CHAIN_IDS } from "@marketplace/shared"
import { BIDS_CONTRACT_ADDRESS } from "@marketplace/contracts"
import type { ActivityRepository } from "../persistence/ActivityRepository"
import type { BidsRepository } from "../persistence/BidsRepository"
import type { CollectionsRepository } from "../persistence/CollectionsRepository"
import type { ListingsRepository } from "../persistence/ListingsRepository"
import type { NFTRepository } from "../persistence/NFTRepository"

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
  }): Promise<void> {
    await this.activityRepo.insert(params)
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
        chainId: CHAIN_IDS.SEPOLIA,
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

    // Cancel previous active bids for this bidder on this collection
    await this.bidsRepo.cancelActiveCollectionBids(String(collection).toLowerCase(), String(bidder).toLowerCase())

    // Insert new collection bid
    await this.bidsRepo.insertCollectionBid({
      collectionAddress: String(collection).toLowerCase(),
      bidderWallet: String(bidder).toLowerCase(),
      price: Number(pricePerItem),
      quantity: Number(quantity),
      expiresAt: expiresAt && Number(expiresAt) > 0 ? new Date(Number(expiresAt) * 1000) : null,
      isActive: true,
      createdAt: new Date(event.blockTimestamp * 1000),
    })

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

    // Get existing bid to check remaining quantity
    const existingBid = await this.bidsRepo.getActiveCollectionBid(String(collection).toLowerCase(), String(bidder).toLowerCase())

    if (existingBid) {
      const remainingQuantity = existingBid.quantity - tokenIds.length

      if (remainingQuantity <= 0) {
        // Fully filled - deactivate the bid
        await this.bidsRepo.deactivateCollectionBid(String(collection).toLowerCase(), String(bidder).toLowerCase(), new Date(event.blockTimestamp * 1000))
      } else {
        // Partially filled - update quantity
        await this.bidsRepo.updateCollectionBidQuantity(String(collection).toLowerCase(), String(bidder).toLowerCase(), remainingQuantity, new Date(event.blockTimestamp * 1000))
      }
    }

    // Update NFT owners for all tokens
    for (const tokenId of tokenIds) {
      await this.upsertNFT(String(collection).toLowerCase(), tokenId.toString(), String(bidder).toLowerCase(), event.blockTimestamp)

      // Cancel any active listings for this token
      await this.listingsRepo.deactivate(`${collection.toLowerCase()}-${tokenId}`, new Date(event.blockTimestamp * 1000))
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

    // Update collection stats
    await this.collectionsRepo.incrementStats(String(collection).toLowerCase(), Number(totalPrice) / 1e18, tokenIds.length)
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

    await this.bidsRepo.deactivateCollectionBid(String(collection).toLowerCase(), String(bidder).toLowerCase(), new Date(event.blockTimestamp * 1000))

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

    // Cancel previous active bids for this bidder on this token
    await this.bidsRepo.cancelActiveTokenBids(String(collection).toLowerCase(), tokenId.toString(), String(bidder).toLowerCase())

    // Insert new token bid
    await this.bidsRepo.insertTokenBid({
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId.toString(),
      bidderWallet: String(bidder).toLowerCase(),
      price: Number(price),
      expiresAt: expiresAt && Number(expiresAt) > 0 ? new Date(Number(expiresAt) * 1000) : null,
      isActive: true,
      createdAt: new Date(event.blockTimestamp * 1000),
    })

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

    // Deactivate the accepted bid
    await this.bidsRepo.deactivateTokenBid(String(collection).toLowerCase(), tokenId.toString(), String(bidder).toLowerCase(), new Date(event.blockTimestamp * 1000))

    // Cancel any active listing for this token
    await this.listingsRepo.deactivate(`${collection.toLowerCase()}-${tokenId}`, new Date(event.blockTimestamp * 1000))

    // Update NFT owner
    await this.upsertNFT(String(collection).toLowerCase(), tokenId.toString(), String(bidder).toLowerCase(), event.blockTimestamp)

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

    // Update collection stats
    await this.collectionsRepo.incrementStats(String(collection).toLowerCase(), Number(price) / 1e18, 1)
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

    await this.bidsRepo.deactivateTokenBid(String(collection).toLowerCase(), tokenId.toString(), String(bidder).toLowerCase(), new Date(event.blockTimestamp * 1000))

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
    new BidsPausedHandler(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new BidsUnpausedHandler(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
  ]
}
