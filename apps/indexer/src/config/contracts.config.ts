import { Address } from "viem"
import { getContractAddresses, MarketplaceBidsABI, MarketplaceCoreABI } from "@marketplace/contracts"
import type { ContractConfig } from "../types/indexer.types"
import { env } from "./env"

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRACT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

// Resolve addresses for whichever chain this indexer process is configured for
// (via CHAIN_ID env var — defaults to Sepolia). This lets the same code index
// either Sepolia or Elysium depending on how the process is launched.
const addresses = getContractAddresses(env.chainId)

/**
 * Centralized configuration for all contracts to index.
 * To add a new contract, simply add it to this array.
 */
export const CONTRACTS_TO_INDEX: ContractConfig[] = [
  {
    name: "core",
    address: addresses.MARKETPLACE_CORE as Address,
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
    address: addresses.MARKETPLACE_BIDS as Address,
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
