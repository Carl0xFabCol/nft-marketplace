import { Address } from "viem"
import type { IEventHandler } from "./IEventHandler"
import type { ParsedEvent } from "../types/indexer.types"
import type { MetadataFetcher } from "../fetchers/MetadataFetcher"
import { logger } from "../utils/logger"
import { toWeiString } from "../utils/wei"
import { requireContractAddresses } from "@marketplace/contracts"
import { env } from "../config/env"
import type { ActivityRepository } from "../persistence/ActivityRepository"
import type { CollectionsRepository } from "../persistence/CollectionsRepository"
import type { ListingsRepository } from "../persistence/ListingsRepository"
import type { NFTRepository } from "../persistence/NFTRepository"

// Resolve the Core contract address for whichever chain this process indexes.
const CORE_CONTRACT_ADDRESS = requireContractAddresses(env.chainId).MARKETPLACE_CORE

// ═══════════════════════════════════════════════════════════════════════════════
// CORE CONTRACT EVENT HANDLERS - FULLY REFACTORED WITH REPOSITORIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Base class for Core contract event handlers.
 * Provides shared utilities and dependencies via repositories.
 */
abstract class BaseCoreHandler<TArgs = Record<string, unknown>> implements IEventHandler<TArgs> {
  readonly contractName = "core"
  abstract readonly eventName: string

  constructor(
    protected activityRepo: ActivityRepository,
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
  }): Promise<boolean> {
    return await this.activityRepo.insert(params)
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
}

// ───────────────────────────────────────────────────────────────────────────────
// COLLECTION EVENTS
// ───────────────────────────────────────────────────────────────────────────────

interface CollectionRegisteredArgs {
  collection: Address
  owner: Address
  royaltyFee: bigint
  isVerified: boolean
}

export class CollectionRegisteredHandler extends BaseCoreHandler<CollectionRegisteredArgs> {
  readonly eventName = "CollectionRegistered"

  async handle(event: ParsedEvent<CollectionRegisteredArgs>): Promise<void> {
    const { collection, owner, royaltyFee, isVerified } = event.args

    logger.info({ collection, owner, blockNumber: event.blockNumber.toString() }, "📝 Handling CollectionRegistered")

    const metadata = await this.metadataFetcher.getCollectionMetadata(collection)
    const deployBlock = Number(event.blockNumber)

    await this.collectionsRepo.upsert({
      contractAddress: String(collection).toLowerCase(),
      chainId: env.chainId,
      creatorWallet: String(owner).toLowerCase(),
      name: metadata.name,
      symbol: metadata.symbol,
      royaltyFee: Number(royaltyFee),
      isVerified: Boolean(isVerified),
      deployedAt: deployBlock,
      indexerBlock: deployBlock,
      createdAt: new Date(event.blockTimestamp * 1000),
      updatedAt: new Date(event.blockTimestamp * 1000),
    })

    await this.insertActivity({
      event: "COLLECTION_REGISTERED",
      collectionAddress: String(collection),
      from: String(owner),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

interface CollectionVerifiedArgs {
  collection: Address
}

export class CollectionVerifiedHandler extends BaseCoreHandler<CollectionVerifiedArgs> {
  readonly eventName = "CollectionVerified"

  async handle(event: ParsedEvent<CollectionVerifiedArgs>): Promise<void> {
    const { collection } = event.args

    logger.info({ collection, blockNumber: event.blockNumber.toString() }, "✅ Handling CollectionVerified")

    await this.collectionsRepo.updateVerificationStatus(String(collection).toLowerCase(), env.chainId, true, new Date(event.blockTimestamp * 1000))

    await this.insertActivity({
      event: "COLLECTION_VERIFIED",
      collectionAddress: String(collection),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

export class CollectionUnverifiedHandler extends BaseCoreHandler<CollectionVerifiedArgs> {
  readonly eventName = "CollectionUnverified"

  async handle(event: ParsedEvent<CollectionVerifiedArgs>): Promise<void> {
    const { collection } = event.args

    logger.info({ collection, blockNumber: event.blockNumber.toString() }, "🚫 Handling CollectionUnverified")

    // IDX-5: without this, verification was a one-way latch in the DB.
    await this.collectionsRepo.updateVerificationStatus(String(collection).toLowerCase(), env.chainId, false, new Date(event.blockTimestamp * 1000))

    await this.insertActivity({
      event: "COLLECTION_UNVERIFIED",
      collectionAddress: String(collection),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

interface CollectionRoyaltyUpdatedArgs {
  collection: Address
  royaltyReceiver: Address
  royaltyFee: number | bigint
}

export class CollectionRoyaltyUpdatedHandler extends BaseCoreHandler<CollectionRoyaltyUpdatedArgs> {
  readonly eventName = "CollectionRoyaltyUpdated"

  async handle(event: ParsedEvent<CollectionRoyaltyUpdatedArgs>): Promise<void> {
    const { collection, royaltyReceiver, royaltyFee } = event.args

    logger.info(
      { collection, royaltyReceiver, royaltyFee: Number(royaltyFee), blockNumber: event.blockNumber.toString() },
      "👑 Handling CollectionRoyaltyUpdated",
    )

    // royaltyFee is uint16 basis points (<= MAX_ROYALTY_FEE), safe as a number.
    // On-chain this also sets royaltyOverridden[collection] = true and the
    // receiver; the DB has no columns for either yet (Phase 3B).
    await this.collectionsRepo.updateRoyaltyFee(String(collection).toLowerCase(), env.chainId, Number(royaltyFee), new Date(event.blockTimestamp * 1000))

    await this.insertActivity({
      event: "COLLECTION_ROYALTY_UPDATED",
      collectionAddress: String(collection),
      to: String(royaltyReceiver),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

export class RoyaltyOverrideClearedHandler extends BaseCoreHandler<CollectionVerifiedArgs> {
  readonly eventName = "RoyaltyOverrideCleared"

  async handle(event: ParsedEvent<CollectionVerifiedArgs>): Promise<void> {
    const { collection } = event.args

    logger.info({ collection, blockNumber: event.blockNumber.toString() }, "👑 Handling RoyaltyOverrideCleared")

    // Activity row only. On-chain only royaltyOverridden flips to false (ERC-2981
    // wins again); the stored royaltyFee is untouched, so collections.royalty_fee
    // stays as is. Modelling the override flag needs a new column (Phase 3B).
    await this.insertActivity({
      event: "ROYALTY_OVERRIDE_CLEARED",
      collectionAddress: String(collection),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// LISTING EVENTS
// ───────────────────────────────────────────────────────────────────────────────

interface ListingCreatedArgs {
  collection: Address
  tokenId: bigint
  seller: Address
  price: bigint
  expiresAt: bigint
}

export class ListingCreatedHandler extends BaseCoreHandler<ListingCreatedArgs> {
  readonly eventName = "ListingCreated"

  async handle(event: ParsedEvent<ListingCreatedArgs>): Promise<void> {
    const { collection, tokenId, seller, price, expiresAt } = event.args

    logger.info(
      {
        collection,
        tokenId: tokenId.toString(),
        seller,
        price: price.toString(),
        blockNumber: event.blockNumber.toString(),
      },
      "🏷️  Handling ListingCreated",
    )

    await this.listingsRepo.upsert({
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId.toString(),
      sellerWallet: String(seller).toLowerCase(),
      price: toWeiString(price),
      expiresAt: expiresAt && Number(expiresAt) > 0 ? new Date(Number(expiresAt) * 1000) : null,
      isActive: true,
      txHash: String(event.transactionHash).toLowerCase(),
      createdAt: new Date(event.blockTimestamp * 1000),
      updatedAt: new Date(),
      status: "confirmed",
      source: "indexer",
    })

    await this.insertActivity({
      event: "LISTING_CREATED",
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId.toString(),
      from: String(seller),
      price: price.toString(),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

interface ListingUpdatedArgs {
  collection: Address
  tokenId: bigint
  newPrice: bigint
}

export class ListingUpdatedHandler extends BaseCoreHandler<ListingUpdatedArgs> {
  readonly eventName = "ListingUpdated"

  async handle(event: ParsedEvent<ListingUpdatedArgs>): Promise<void> {
    const { collection, tokenId, newPrice } = event.args

    logger.info(
      {
        collection,
        tokenId: tokenId.toString(),
        newPrice: newPrice.toString(),
        blockNumber: event.blockNumber.toString(),
      },
      "🔄 Handling ListingUpdated",
    )

    await this.listingsRepo.updatePrice(String(collection).toLowerCase(), tokenId.toString(), toWeiString(newPrice), new Date(event.blockTimestamp * 1000))

    await this.insertActivity({
      event: "LISTING_UPDATED",
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId.toString(),
      price: newPrice.toString(),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

interface ListingCancelledArgs {
  collection: Address
  tokenId: bigint
  seller: Address
}

export class ListingCancelledHandler extends BaseCoreHandler<ListingCancelledArgs> {
  readonly eventName = "ListingCancelled"

  async handle(event: ParsedEvent<ListingCancelledArgs>): Promise<void> {
    const { collection, tokenId, seller } = event.args

    logger.info(
      {
        collection,
        tokenId: tokenId.toString(),
        seller,
        blockNumber: event.blockNumber.toString(),
      },
      "❌ Handling ListingCancelled",
    )

    await this.listingsRepo.deactivate(String(collection).toLowerCase(), tokenId.toString(), new Date(event.blockTimestamp * 1000))

    await this.insertActivity({
      event: "LISTING_CANCELLED",
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId.toString(),
      from: String(seller),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// SALE EVENT
// ───────────────────────────────────────────────────────────────────────────────

interface SaleArgs {
  collection: Address
  tokenId: bigint
  seller: Address
  buyer: Address
  price: bigint
  marketplaceFeeAmount: bigint
  royaltyAmount: bigint
}

export class SaleHandler extends BaseCoreHandler<SaleArgs> {
  readonly eventName = "Sale"

  async handle(event: ParsedEvent<SaleArgs>): Promise<void> {
    const { collection, tokenId, seller, buyer, price } = event.args

    logger.info(
      {
        collection,
        tokenId: tokenId.toString(),
        seller,
        buyer,
        price: price.toString(),
        blockNumber: event.blockNumber.toString(),
      },
      "💰 Handling Sale",
    )

    // Update listing via repository
    await this.listingsRepo.deactivate(String(collection).toLowerCase(), tokenId.toString(), new Date(event.blockTimestamp * 1000), String(buyer).toLowerCase())

    // Update NFT owner
    await this.updateNFTOwner(String(collection).toLowerCase(), tokenId.toString(), String(buyer).toLowerCase(), event.blockTimestamp)

    // IDX-1: Sale is the single source of collection volume/sales. It is
    // emitted on every value transfer: buy, buyBatch, and once per tokenId on
    // token- and collection-bid acceptance (Core.executeSaleFromBid).
    //
    // indexer_record_sale writes the SALE activity row and the chain-scoped
    // stats in one transaction, keyed on (tx_hash, log_index): a replay is a
    // no-op and a failure leaves neither write behind.
    await this.activityRepo.recordSale({
      collectionAddress: String(collection),
      tokenId: tokenId.toString(),
      from: String(seller),
      to: String(buyer),
      priceWei: toWeiString(price),
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

interface MarketplaceFeeUpdatedArgs {
  oldFee: bigint
  newFee: bigint
}

export class MarketplaceFeeUpdatedHandler extends BaseCoreHandler<MarketplaceFeeUpdatedArgs> {
  readonly eventName = "MarketplaceFeeUpdated"

  async handle(event: ParsedEvent<MarketplaceFeeUpdatedArgs>): Promise<void> {
    logger.info(
      {
        oldFee: event.args.oldFee.toString(),
        newFee: event.args.newFee.toString(),
        blockNumber: event.blockNumber.toString(),
      },
      "⚙️  Handling MarketplaceFeeUpdated",
    )

    await this.insertActivity({
      event: "MARKETPLACE_FEE_UPDATED",
      collectionAddress: CORE_CONTRACT_ADDRESS.toLowerCase(),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

interface FeeReceiverUpdatedArgs {
  oldReceiver: Address
  newReceiver: Address
}

export class FeeReceiverUpdatedHandler extends BaseCoreHandler<FeeReceiverUpdatedArgs> {
  readonly eventName = "FeeReceiverUpdated"

  async handle(event: ParsedEvent<FeeReceiverUpdatedArgs>): Promise<void> {
    const { oldReceiver, newReceiver } = event.args

    logger.info(
      {
        oldReceiver,
        newReceiver,
        blockNumber: event.blockNumber.toString(),
      },
      "⚙️  Handling FeeReceiverUpdated",
    )

    await this.insertActivity({
      event: "FEE_RECEIVER_UPDATED",
      collectionAddress: CORE_CONTRACT_ADDRESS.toLowerCase(),
      from: String(oldReceiver),
      to: String(newReceiver),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

interface OwnershipTransferredArgs {
  previousOwner: Address
  newOwner: Address
}

export class OwnershipTransferredHandler extends BaseCoreHandler<OwnershipTransferredArgs> {
  readonly eventName = "OwnershipTransferred"

  async handle(event: ParsedEvent<OwnershipTransferredArgs>): Promise<void> {
    const { previousOwner, newOwner } = event.args

    logger.info(
      {
        previousOwner,
        newOwner,
        blockNumber: event.blockNumber.toString(),
      },
      "👑 Handling OwnershipTransferred",
    )

    await this.insertActivity({
      event: "OWNERSHIP_TRANSFERRED",
      collectionAddress: CORE_CONTRACT_ADDRESS.toLowerCase(),
      from: String(previousOwner).toLowerCase(),
      to: String(newOwner).toLowerCase(),
      txHash: String(event.transactionHash).toLowerCase(),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

interface LaunchpadAuthorizedArgs {
  launchpad: Address
  authorized: boolean
}

/**
 * Replaces the stale ContractAuthorizedHandler: the contract event is
 * LaunchpadAuthorized(address indexed launchpad, bool authorized). The boolean
 * is encoded in the event name instead of being stored in activity.price.
 */
export class LaunchpadAuthorizedHandler extends BaseCoreHandler<LaunchpadAuthorizedArgs> {
  readonly eventName = "LaunchpadAuthorized"

  async handle(event: ParsedEvent<LaunchpadAuthorizedArgs>): Promise<void> {
    const { launchpad, authorized } = event.args

    logger.info({ launchpad, authorized, blockNumber: event.blockNumber.toString() }, "🔐 Handling LaunchpadAuthorized")

    await this.insertActivity({
      event: authorized ? "LAUNCHPAD_AUTHORIZED" : "LAUNCHPAD_DEAUTHORIZED",
      // Admin event: keyed on the Core address like the other admin events (IDX-10 open).
      collectionAddress: CORE_CONTRACT_ADDRESS.toLowerCase(),
      to: String(launchpad).toLowerCase(),
      txHash: String(event.transactionHash).toLowerCase(),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

interface WithdrawalArgs {
  account: Address
  amount: bigint
}

/** Seller/fee/royalty proceeds pulled from Core. Activity row only (no balances table). */
export class CoreWithdrawalHandler extends BaseCoreHandler<WithdrawalArgs> {
  readonly eventName = "Withdrawal"

  async handle(event: ParsedEvent<WithdrawalArgs>): Promise<void> {
    const { account, amount } = event.args

    logger.info({ account, amount: amount.toString(), blockNumber: event.blockNumber.toString() }, "💸 Handling Core Withdrawal")

    await this.insertActivity({
      event: "WITHDRAWAL",
      collectionAddress: CORE_CONTRACT_ADDRESS.toLowerCase(),
      to: String(account).toLowerCase(),
      price: toWeiString(amount),
      txHash: String(event.transactionHash).toLowerCase(),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

export class PausedHandler extends BaseCoreHandler {
  readonly eventName = "Paused"

  async handle(event: ParsedEvent): Promise<void> {
    logger.info({ blockNumber: event.blockNumber.toString() }, "⏸️  Handling Paused")

    await this.insertActivity({
      event: "PAUSED",
      collectionAddress: CORE_CONTRACT_ADDRESS.toLowerCase(),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: this.contractName,
    })
  }
}

export class UnpausedHandler extends BaseCoreHandler {
  readonly eventName = "Unpaused"

  async handle(event: ParsedEvent): Promise<void> {
    logger.info({ blockNumber: event.blockNumber.toString() }, "▶️  Handling Unpaused")

    await this.insertActivity({
      event: "UNPAUSED",
      collectionAddress: CORE_CONTRACT_ADDRESS.toLowerCase(),
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
 * Create all Core event handlers with repository dependencies.
 * Factory function to instantiate all handlers with clean dependency injection.
 */
export function createCoreEventHandlers(
  activityRepo: ActivityRepository,
  collectionsRepo: CollectionsRepository,
  listingsRepo: ListingsRepository,
  nftRepo: NFTRepository,
  metadataFetcher: MetadataFetcher,
): IEventHandler<any>[] {
  return [
    new CollectionRegisteredHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new CollectionVerifiedHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new CollectionUnverifiedHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new CollectionRoyaltyUpdatedHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new RoyaltyOverrideClearedHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new ListingCreatedHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new ListingUpdatedHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new ListingCancelledHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new SaleHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new MarketplaceFeeUpdatedHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new FeeReceiverUpdatedHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new OwnershipTransferredHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new LaunchpadAuthorizedHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new CoreWithdrawalHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new PausedHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
    new UnpausedHandler(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadataFetcher),
  ]
}
