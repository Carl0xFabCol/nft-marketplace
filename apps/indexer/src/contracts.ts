// ─────────────────────────────────────────────────────────────────────────────
// This file previously contained ~1400 lines of duplicated ABI definitions
// and hardcoded contract addresses.
//
// All ABI and address definitions now live in the single source of truth:
//   packages/contracts/src/
//
// This file is kept as a thin re-export so that existing imports within
// apps/indexer/src/* continue to work without change. Once all consumers
// are updated to import directly from @marketplace/contracts, this file
// can be deleted.
// ─────────────────────────────────────────────────────────────────────────────

export {
  MarketplaceABI,
  MarketplaceBidsABI,
  MarketplaceCoreABI,
  nftAbi,
  MockNFTAbi,
  MARKETPLACE_CONTRACT_ADDRESS,
  BIDS_CONTRACT_ADDRESS,
  CORE_CONTRACT_ADDRESS,
  SEPOLIA_ADDRESSES,
  CONTRACT_ADDRESSES,
} from "@marketplace/contracts";
