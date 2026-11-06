// ─────────────────────────────────────────────────────────────────────────────
// Test #8 (INTEGRATION_AUDIT §10): frontend call-shape.
//
// For every contract call in apps/web, encode the call with the GENERATED ABI
// (src/abis/*.generated.ts, built from the current Solidity) using exactly the
// argument shape the hook/component passes today. A selector or arity change
// on-chain then fails here instead of reverting in a user's wallet.
//
// KNOWN-FAILING by design (Phase 0): acceptTokenBid and acceptCollectionBid
// pass 3 args; the contracts take 5 (minPrice/minSellerProceeds). Fixed in
// Phase 4 (ABI-1). Runs only in the continue-on-error CI job; excluded from
// the default `vitest run`. Do not weaken it: fix the call site instead.
//
// The ABIs are widened to `Abi` on purpose so a wrong arity is a runtime
// assertion failure here, not a typecheck failure of the whole package.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { encodeFunctionData, erc721Abi, type Abi } from "viem"
import { HypercAbi } from "../abis/collection.generated"
import { MarketplaceAbi } from "../abis/full.generated"
import { LaunchPadAbi } from "../abis/launchpad.generated"

const WEB_ROOT = path.resolve(__dirname, "../../../../apps/web")

/** Web-side ABI import name → generated ABI for the same contract. */
const ABIS: Record<string, Abi> = {
  MarketplaceABI: MarketplaceAbi as Abi,
  LaunchPadABI: LaunchPadAbi as Abi,
  MiColeccionABI: HypercAbi as Abi,
  erc721Abi: erc721Abi as Abi, // viem's canonical ERC-721 (not hand-pasted)
}

const COLLECTION = "0x1000000000000000000000000000000000000001" as const
const OTHER = "0x2000000000000000000000000000000000000002" as const
const CORE = "0x3000000000000000000000000000000000000003" as const

interface CallSite {
  /** Path relative to apps/web. */
  readonly file: string
  readonly abi: keyof typeof ABIS
  readonly functionName: string
  /** Same count and JS types as the call site passes (see the comment per row). */
  readonly args: readonly unknown[]
}

// Mirrors `git grep -n "functionName:" apps/web`. The guard test below fails if
// a call site is added or removed without updating this table.
const CALL_SITES: readonly CallSite[] = [
  // hooks/useBidActions.ts
  { file: "hooks/useBidActions.ts", abi: "MarketplaceABI", functionName: "placeTokenBid", args: [COLLECTION, 1n, 10n ** 18n, BigInt(1790000000)] },
  { file: "hooks/useBidActions.ts", abi: "MarketplaceABI", functionName: "placeTokenBidBatch", args: [COLLECTION, [1n, 2n], [1n, 2n], [1790000000, 1790000000].map(BigInt)] },
  { file: "hooks/useBidActions.ts", abi: "MarketplaceABI", functionName: "cancelTokenBid", args: [COLLECTION, BigInt(1)] },
  { file: "hooks/useBidActions.ts", abi: "MarketplaceABI", functionName: "cancelTokenBidBatch", args: [[COLLECTION], [1n]] },
  // KNOWN FAILURE (Phase 4, ABI-1): args: [collection, BigInt(tokenId), bidder]
  { file: "hooks/useBidActions.ts", abi: "MarketplaceABI", functionName: "acceptTokenBid", args: [COLLECTION, BigInt(1), OTHER] },
  // KNOWN FAILURE (Phase 4, ABI-1): args: [collection, bidder, tokenIds]
  { file: "hooks/useBidActions.ts", abi: "MarketplaceABI", functionName: "acceptCollectionBid", args: [COLLECTION, OTHER, [1n]] },
  { file: "hooks/useBidActions.ts", abi: "MarketplaceABI", functionName: "placeCollectionBid", args: [COLLECTION, 10n ** 18n, 1, BigInt(1790000000)] },
  { file: "hooks/useBidActions.ts", abi: "MarketplaceABI", functionName: "cancelCollectionBid", args: [COLLECTION] },
  // hooks/useCollectionActions.ts: args: [collection, Number(royaltyFee), receiver]
  { file: "hooks/useCollectionActions.ts", abi: "MarketplaceABI", functionName: "registerCollection", args: [COLLECTION, Number(500n), OTHER] },
  // hooks/useBuyActions.ts
  { file: "hooks/useBuyActions.ts", abi: "MarketplaceABI", functionName: "buy", args: [COLLECTION, 1n] },
  { file: "hooks/useBuyActions.ts", abi: "MarketplaceABI", functionName: "buyBatch", args: [COLLECTION, [1n, 2n]] },
  // hooks/useEnsureApproval.ts (viem erc721Abi)
  { file: "hooks/useEnsureApproval.ts", abi: "erc721Abi", functionName: "isApprovedForAll", args: [OTHER, CORE] },
  { file: "hooks/useEnsureApproval.ts", abi: "erc721Abi", functionName: "setApprovalForAll", args: [CORE, true] },
  // hooks/useListingActions.ts
  { file: "hooks/useListingActions.ts", abi: "MarketplaceABI", functionName: "cancelListing", args: [COLLECTION, BigInt(1)] },
  { file: "hooks/useListingActions.ts", abi: "MarketplaceABI", functionName: "cancelListingBatch", args: [[COLLECTION], [1n]] },
  // hooks/useLaunchpadActions.ts
  { file: "hooks/useLaunchpadActions.ts", abi: "LaunchPadABI", functionName: "launchFee", args: [] },
  { file: "hooks/useLaunchpadActions.ts", abi: "LaunchPadABI", functionName: "MAX_ROYALTY_FEE", args: [] },
  { file: "hooks/useLaunchpadActions.ts", abi: "LaunchPadABI", functionName: "paused", args: [] },
  // args: [name, symbol, royaltyFee:number, royaltyReceiver, maxSupply:bigint, baseURI, mintPrice:bigint, mintDuration:bigint]
  { file: "hooks/useLaunchpadActions.ts", abi: "LaunchPadABI", functionName: "createCollection", args: ["Name", "SYM", 500, OTHER, 100n, "ipfs://base/", 0n, 0n] },
  // hooks/useMarketplaceReads.ts
  { file: "hooks/useMarketplaceReads.ts", abi: "MiColeccionABI", functionName: "totalSupply", args: [] },
  { file: "hooks/useMarketplaceReads.ts", abi: "MiColeccionABI", functionName: "maxSupply", args: [] },
  { file: "hooks/useMarketplaceReads.ts", abi: "MiColeccionABI", functionName: "mintPrice", args: [] },
  { file: "hooks/useMarketplaceReads.ts", abi: "MiColeccionABI", functionName: "mintEndsAt", args: [] },
  { file: "hooks/useMarketplaceReads.ts", abi: "MiColeccionABI", functionName: "isMintActive", args: [] },
  { file: "hooks/useMarketplaceReads.ts", abi: "MarketplaceABI", functionName: "owner", args: [] },
  { file: "hooks/useMarketplaceReads.ts", abi: "MarketplaceABI", functionName: "marketplaceFee", args: [] },
  { file: "hooks/useMarketplaceReads.ts", abi: "MarketplaceABI", functionName: "feeReceiver", args: [] },
  { file: "hooks/useMarketplaceReads.ts", abi: "MarketplaceABI", functionName: "totalListings", args: [] },
  { file: "hooks/useMarketplaceReads.ts", abi: "MarketplaceABI", functionName: "totalSales", args: [] },
  { file: "hooks/useMarketplaceReads.ts", abi: "MarketplaceABI", functionName: "totalVolume", args: [] },
  // hooks/useMintActions.ts: args: [to, BigInt(amount)]
  { file: "hooks/useMintActions.ts", abi: "MiColeccionABI", functionName: "batchMint", args: [OTHER, BigInt(3)] },
  // hooks/useUserNfts.ts (viem erc721Abi)
  { file: "hooks/useUserNfts.ts", abi: "erc721Abi", functionName: "isApprovedForAll", args: [OTHER, CORE] },
  { file: "hooks/useUserNfts.ts", abi: "erc721Abi", functionName: "setApprovalForAll", args: [CORE, true] },
  // components/features/user/UserListCard.tsx
  { file: "components/features/user/UserListCard.tsx", abi: "erc721Abi", functionName: "name", args: [] },
  { file: "components/features/user/UserListCard.tsx", abi: "MarketplaceABI", functionName: "collections", args: [COLLECTION] },
  // args: [collections, tokenIds.map(BigInt), prices.map(BigInt), expiresAts.map(BigInt)]
  { file: "components/features/user/UserListCard.tsx", abi: "MarketplaceABI", functionName: "createListingBatch", args: [[COLLECTION], ["1"].map(BigInt), ["1000"].map(BigInt), ["1790000000"].map(BigInt)] },
  // components/features/collections/collection/CollectionClientArea.tsx
  { file: "components/features/collections/collection/CollectionClientArea.tsx", abi: "erc721Abi", functionName: "name", args: [] },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** Every `functionName: "x"` literal in apps/web, as "file#name" (with multiplicity). */
function webCallSites(): string[] {
  const found: string[] = []
  for (const file of walk(WEB_ROOT)) {
    const rel = path.relative(WEB_ROOT, file).split(path.sep).join("/")
    for (const m of readFileSync(file, "utf8").matchAll(/functionName:\s*["'`]([A-Za-z0-9_]+)["'`]/g)) {
      found.push(`${rel}#${m[1]}`)
    }
  }
  return found.sort()
}

describe("frontend call-shape (test #8)", () => {
  it("the table covers every functionName call site in apps/web", () => {
    expect(CALL_SITES.map((c) => `${c.file}#${c.functionName}`).sort()).toEqual(webCallSites())
  })

  for (const site of CALL_SITES) {
    it(`${site.file}: ${site.functionName}(${site.args.length} args) encodes against the generated ABI`, () => {
      expect(() =>
        encodeFunctionData({ abi: ABIS[site.abi], functionName: site.functionName, args: site.args }),
      ).not.toThrow()
    })
  }
})
