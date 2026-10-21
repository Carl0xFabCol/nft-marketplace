import type { Address } from "viem"
import type { IEventHandler } from "./IEventHandler"
import type { ParsedEvent } from "../types/indexer.types"
import type { MetadataFetcher } from "../fetchers/MetadataFetcher"
import type { ActivityRepository } from "../persistence/ActivityRepository"
import type { NFTRepository } from "../persistence/NFTRepository"
import { env } from "../config/env"

// ═══════════════════════════════════════════════════════════════════════════════
// NFT TRANSFER EVENT HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Arguments for the ERC721 Transfer event.
 * Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
 */
interface TransferArgs {
  from: Address
  to: Address
  tokenId: bigint
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const

/**
 * Handles ERC721 Transfer events from dynamically-registered NFT collections.
 *
 * The Transfer event is emitted by every ERC721 contract with:
 *   from: the sender (zero address for mint),
 *   to: the recipient (zero address for burn),
 *   tokenId: the NFT identifier
 *
 * On the same collection_address, token_id, chain_id PK:
 *   - Mints upsert the NFT with its tokenURI/metadata (fetched once per token).
 *   - Transfers/burns call updateOwner(), which is idempotent and inserts the
 *     row if it was never seen (e.g. the indexer started after the mint).
 *   - Activity insert uses upsert with ignoreDuplicates — idempotent as well.
 *
 * The handler is stateless and contains no mutable state, making it
 * crash-safe and restart-safe.
 */
export class TransferHandler implements IEventHandler<TransferArgs> {
  readonly contractName = "nft"
  readonly eventName = "Transfer"

  constructor(
    private activityRepo: ActivityRepository,
    private nftRepo: NFTRepository,
    private metadataFetcher: MetadataFetcher,
  ) {}

  async handle(event: ParsedEvent<TransferArgs>): Promise<void> {
    const { from, to, tokenId } = event.args
    const collectionAddress = String(event.contractAddress)
    const tokenIdString = tokenId.toString()
    const timestamp = new Date(event.blockTimestamp * 1000)

    const isMint = String(from).toLowerCase() === ZERO_ADDRESS
    const isBurn = String(to).toLowerCase() === ZERO_ADDRESS

    if (isMint) {
      // Mint: create the NFT row with metadata so it shows up in the frontend.
      const nftData = await this.metadataFetcher.getNFTData(event.contractAddress, tokenIdString)

      if (nftData.tokenUri) {
        await this.nftRepo.upsert({
          collectionAddress,
          tokenId: tokenIdString,
          ownerWallet: to,
          lastSynced: timestamp,
          chainId: env.chainId,
          tokenUri: nftData.tokenUri,
          imageUrl: nftData.imageUrl,
          metadata: nftData.metadata,
          mintedAt: timestamp,
        })
      } else {
        // No tokenURI (or metadata fetch failed) — still record ownership.
        await this.nftRepo.updateOwner(collectionAddress, tokenIdString, to, timestamp)
      }
    } else if (isBurn) {
      // Burn: update owner to zero address, marking the NFT as burned
      await this.nftRepo.updateOwner(collectionAddress, tokenIdString, ZERO_ADDRESS, timestamp)
    } else {
      // Normal transfer: update the NFT owner to 'to'
      await this.nftRepo.updateOwner(collectionAddress, tokenIdString, to, timestamp)
    }

    // Record the activity (upsert for idempotency on crash/restart)
    await this.activityRepo.insert({
      event: "TRANSFER",
      collectionAddress: collectionAddress.toLowerCase(),
      tokenId: tokenIdString,
      from: isMint ? undefined : String(from).toLowerCase(),
      to: isBurn ? undefined : String(to).toLowerCase(),
      txHash: String(event.transactionHash),
      createdAt: new Date(event.blockTimestamp * 1000),
      logIndex: event.logIndex,
      sourceContract: "nft_transfer",
    })
  }
}

/**
 * Factory function for creating a TransferHandler instance.
 * Matches the pattern used by CoreEventHandler and BidsEventHandler.
 */
export function createTransferHandler(
  activityRepo: ActivityRepository,
  nftRepo: NFTRepository,
  metadataFetcher: MetadataFetcher,
): IEventHandler<any> {
  return new TransferHandler(activityRepo, nftRepo, metadataFetcher)
}
