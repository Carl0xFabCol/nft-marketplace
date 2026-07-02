import { Address } from "viem"
import { BIDS_CONTRACT_ADDRESS, CORE_CONTRACT_ADDRESS, MarketplaceBidsABI, MarketplaceCoreABI } from "@marketplace/contracts"
import type { ContractConfig } from "../types/indexer.types"

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRACT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Centralized configuration for all contracts to index.
 * To add a new contract, simply add it to this array.
 */
export const CONTRACTS_TO_INDEX: ContractConfig[] = [
  {
    name: "core",
    address: CORE_CONTRACT_ADDRESS as Address,
    abi: MarketplaceCoreABI,
    events: [
      // Collection events
      "CollectionRegistered",
      "CollectionVerified",
      "ContractAuthorized",
      // Listing events
      "ListingCreated",
      "ListingUpdated",
      "ListingCancelled",
      // Sale events
      "Sale",
      // Admin events
      "MarketplaceFeeUpdated",
      "FeeReceiverUpdated",
      "OwnershipTransferred",
      "Paused",
      "Unpaused",
    ],
  },
  {
    name: "bids",
    address: BIDS_CONTRACT_ADDRESS as Address,
    abi: MarketplaceBidsABI,
    events: [
      // Collection bid events
      "CollectionBidPlaced",
      "CollectionBidAccepted",
      "CollectionBidCancelled",
      // Token bid events
      "TokenBidPlaced",
      "TokenBidAccepted",
      "TokenBidCancelled",
      // Admin events
      "Paused",
      "Unpaused",
    ],
  },
]
