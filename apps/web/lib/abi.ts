// ─────────────────────────────────────────────────────────────────────────────
// This file previously contained ~1100 lines of duplicated ABI definitions.
//
// All ABIs now live in the single source of truth:
//   packages/contracts/src/abis/
//
// This file is a backward-compatible re-export so that existing imports
// within apps/web/* continue to work without any changes to consumers.
// The `MockAbi` alias preserves the old export name used by the mint flow.
// ─────────────────────────────────────────────────────────────────────────────

export {
  nftAbi,
  MarketplaceABI,
  MarketplaceBidsABI,
  MarketplaceCoreABI,
  LaunchPadABI,
  MiColeccionABI,
  MockNFTAbi as MockAbi,
} from "@marketplace/contracts";
