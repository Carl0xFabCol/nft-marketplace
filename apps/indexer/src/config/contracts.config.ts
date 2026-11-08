import { Address } from "viem"
import { requireContractAddresses } from "@marketplace/contracts"
// Decode with the ABIs generated from the compiled contracts, not the
// hand-pasted ones: the hand-pasted Core ABI lacks CollectionUnverified,
// RoyaltyOverrideCleared and others, and BatchEventFetcher silently skips logs
// it cannot decode (Phase 3A, IDX-5). The web still uses the hand-pasted ABIs
// until Phase 4.
import { MarketplaceBidsEventsAbi, MarketplaceCoreEventsAbi } from "@marketplace/contracts/abis/generated/events"
import type { ContractConfig } from "../types/indexer.types"
import { env } from "./env"

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRACT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

// Resolve addresses for whichever chain this indexer process is configured for
// (via the required CHAIN_ID env var). This lets the same code index
// either Sepolia or Elysium depending on how the process is launched.
const addresses = requireContractAddresses(env.chainId)

/**
 * Centralized configuration for all contracts to index.
 * To add a new contract, simply add it to this array.
 */
export const CONTRACTS_TO_INDEX: ContractConfig[] = [
  {
    name: "core",
    address: addresses.MARKETPLACE_CORE as Address,
    abi: MarketplaceCoreEventsAbi,
    // Deliberately NOT indexed (guarded by handlers/EventCoverage.test.ts):
    // - CollectionRegistrationExecuted: emitted next to CollectionRegistered on
    //   the router path (MarketplaceCore.sol _registerCollectionFromRouter);
    //   handling both would double-insert the collection (IDX-12).
    // - RoyaltySourceUsed: emitted on every royalty computation of a sale;
    //   per-sale telemetry with no table to land in.
    events: [
      // Collection events
      "CollectionRegistered",
      "CollectionVerified",
      "CollectionUnverified",
      "CollectionRoyaltyUpdated",
      "RoyaltyOverrideCleared",
      "LaunchpadAuthorized",
      // Listing events
      "ListingCreated",
      "ListingUpdated",
      "ListingCancelled",
      // Sale events
      "Sale",
      // Proceeds
      "Withdrawal",
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
    abi: MarketplaceBidsEventsAbi,
    events: [
      // Collection bid events
      "CollectionBidPlaced",
      "CollectionBidAccepted",
      "CollectionBidCancelled",
      // Token bid events
      "TokenBidPlaced",
      "TokenBidAccepted",
      "TokenBidCancelled",
      // Proceeds
      "Withdrawal",
      // Admin events
      "Paused",
      "Unpaused",
    ],
  },
]
