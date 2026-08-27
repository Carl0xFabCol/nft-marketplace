import { erc721Abi, type Address } from "viem"
import type { IEventHandler } from "./IEventHandler"
import type { ParsedEvent } from "../types/indexer.types"
import type { ActivityRepository } from "../persistence/ActivityRepository"
import type { NFTRepository } from "../persistence/NFTRepository"

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

/**
 * Handles ERC721 Transfer events from dynamically-registered NFT collections.
 *
 * The Transfer event is emitted by every ERC721 contract with:
 *   from: the sender (zero address for mint),
 *   to: the recipient (zero address for burn),
 *   tokenId: the NFT identifier
 *
 * On the same collection_address, token_id, chain_id PK:
 *   - updateOwner() performs a pure UPDATE — idempotent if the same transfer
 *     is processed multiple times.
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
  ) {}

  async handle(event: ParsedEvent<TransferArgs>): Promise<void> {
    const { from, to, tokenId } = event.args
    const collectionAddress = String(event.contractAddress)
    const tokenIdString = tokenId.toString()

    const isMint = from === "0x0000000000000000000000000000000000000000"
    const isBurn = to === "0x0000000000000000000000000000000000000000"

    if (isBurn) {
      // Burn: update owner to zero address, marking the NFT as burned
      await this.nftRepo.updateOwner(collectionAddress, tokenIdString, from, new Date(event.blockTimestamp * 1000))
    } else {
      // Normal transfer: update the NFT owner to 'to'
      await this.nftRepo.updateOwner(collectionAddress, tokenIdString, to, new Date(event.blockTimestamp * 1000))
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
export function createTransferHandler(activityRepo: ActivityRepository, nftRepo: NFTRepository): IEventHandler<any> {
  return new TransferHandler(activityRepo, nftRepo)
}
