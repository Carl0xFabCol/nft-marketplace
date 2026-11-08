// ─────────────────────────────────────────────────────────────────────────────
// Test #8 (INTEGRATION_AUDIT §10): frontend call-shape.
//
// For every contract call in apps/web, encode the call with the GENERATED ABI
// (src/abis/*.generated.ts, built from the current Solidity) using exactly the
// argument shape the hook/component passes today. A selector or arity change
// on-chain then fails here instead of reverting in a user's wallet.
//
// Phase 0 shipped this red on acceptTokenBid/acceptCollectionBid (3 args vs
// 5); Phase 4 (ABI-1) fixed the hooks. Excluded from the default `vitest run`;
// runs via `pnpm validate:integration` and the blocking CI job. Do not weaken
// it: fix the call site instead.
//
// Drift guard: the table's arg COUNT per row must equal the number of
// top-level elements in the call site's `args: [...]` literal (0 when the call
// has no `args`). A non-literal `args` fails the guard on purpose.
//
// The ABIs are widened to `Abi` on purpose so a wrong arity is a runtime
// assertion failure here, not a typecheck failure of the whole package.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { encodeFunctionData, erc721Abi, parseAbi, type Abi } from "viem"
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
  // Standard IERC2981 + IERC165, as lib/bidAcceptance.ts declares it (raw eth_call).
  erc2981Abi: parseAbi([
    "function supportsInterface(bytes4 interfaceId) view returns (bool)",
    "function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address receiver, uint256 royaltyAmount)",
  ]),
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
  // args: [quote.collection, quote.tokenIds[0], quote.bidder, minPrice, minSellerProceeds] (bigint bounds from acceptBounds)
  { file: "hooks/useBidActions.ts", abi: "MarketplaceABI", functionName: "acceptTokenBid", args: [COLLECTION, 1n, OTHER, 10n ** 18n, 925n * 10n ** 15n] },
  // args: [quote.collection, quote.bidder, quote.tokenIds, minPrice (per item), minSellerProceeds (total)]
  { file: "hooks/useBidActions.ts", abi: "MarketplaceABI", functionName: "acceptCollectionBid", args: [COLLECTION, OTHER, [1n, 2n], 10n ** 18n, 185n * 10n ** 16n] },
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
  // lib/bidAcceptance.ts (accept-bid quote: router reads + the collection's ERC-2981)
  { file: "lib/bidAcceptance.ts", abi: "MarketplaceABI", functionName: "marketplaceFee", args: [] },
  { file: "lib/bidAcceptance.ts", abi: "MarketplaceABI", functionName: "royaltyOverridden", args: [COLLECTION] },
  { file: "lib/bidAcceptance.ts", abi: "MarketplaceABI", functionName: "collections", args: [COLLECTION] },
  { file: "lib/bidAcceptance.ts", abi: "MarketplaceABI", functionName: "tokenBids", args: [COLLECTION, 1n, OTHER] },
  { file: "lib/bidAcceptance.ts", abi: "MarketplaceABI", functionName: "collectionBids", args: [COLLECTION, OTHER] },
  { file: "lib/bidAcceptance.ts", abi: "erc2981Abi", functionName: "supportsInterface", args: ["0x2a55205a"] },
  { file: "lib/bidAcceptance.ts", abi: "erc2981Abi", functionName: "royaltyInfo", args: [1n, 10n ** 18n] },
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
  return webCallSitesWithArity().map((s) => s.replace(/\/-?\d+$/, ""))
}

/**
 * Top-level element count of the array literal starting at `src[open]` ("["),
 * skipping strings/template literals and nested ()[]{}.
 */
function countTopLevelElements(src: string, open: number): number {
  let depth = 0
  let count = 0
  let sawToken = false
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = src.indexOf(ch, i + 1)
      i = end < 0 ? src.length : end
      sawToken = true
      continue
    }
    if (ch === "[" || ch === "(" || ch === "{") {
      depth++
      if (depth > 1) sawToken = true
      continue
    }
    if (ch === "]" || ch === ")" || ch === "}") {
      depth--
      if (depth === 0) return sawToken ? count + 1 : count
      continue
    }
    if (depth === 1 && ch === ",") {
      if (sawToken) count++
      sawToken = false
      continue
    }
    if (depth >= 1 && !/\s/.test(ch)) sawToken = true
  }
  throw new Error("unterminated array literal")
}

/**
 * Arity of the call object containing `functionName` at `at`: the element count
 * of its `args: [...]`, 0 if the object has no `args`, -1 if `args` is not an
 * array literal (the guard then fails, by design).
 */
function callSiteArity(src: string, at: number): number {
  let depth = 0
  for (let i = at; i < src.length; i++) {
    const ch = src[i]
    if (ch === "{" || ch === "[" || ch === "(") depth++
    else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth === 0) return 0 // end of the call object, no args
      depth--
    } else if (depth === 0 && src.startsWith("args:", i)) {
      const m = /^args:\s*/.exec(src.slice(i))!
      const open = i + m[0].length
      return src[open] === "[" ? countTopLevelElements(src, open) : -1
    }
  }
  return -1
}

/** "file#name/arity" for every call site in apps/web. */
function webCallSitesWithArity(): string[] {
  const found: string[] = []
  for (const file of walk(WEB_ROOT)) {
    const rel = path.relative(WEB_ROOT, file).split(path.sep).join("/")
    const src = readFileSync(file, "utf8")
    for (const m of src.matchAll(/functionName:\s*["'`]([A-Za-z0-9_]+)["'`]/g)) {
      found.push(`${rel}#${m[1]}/${callSiteArity(src, m.index! + m[0].length)}`)
    }
  }
  return found.sort()
}

describe("frontend call-shape (test #8)", () => {
  it("the table covers every functionName call site in apps/web", () => {
    expect(CALL_SITES.map((c) => `${c.file}#${c.functionName}`).sort()).toEqual(webCallSites())
  })

  it("each row passes as many args as the call site's args literal (drift guard)", () => {
    expect(CALL_SITES.map((c) => `${c.file}#${c.functionName}/${c.args.length}`).sort()).toEqual(webCallSitesWithArity())
  })

  it("the arity parser counts top-level elements only", () => {
    const at = (src: string) => callSiteArity(src, src.indexOf('"f"') + 3)
    expect(at('{ functionName: "f", args: [a, b.map((x, y) => [x, y]), "c,d", `e,${f}`, { g, h }] }')).toBe(5)
    expect(at('{ functionName: "f", args: [] }')).toBe(0)
    expect(at('{ functionName: "f", address }')).toBe(0)
    expect(at('{ functionName: "f", args: buildArgs() }')).toBe(-1)
    expect(at('{ functionName: "f", args: [a, b,] }')).toBe(2)
  })

  for (const site of CALL_SITES) {
    it(`${site.file}: ${site.functionName}(${site.args.length} args) encodes against the generated ABI`, () => {
      expect(() =>
        encodeFunctionData({ abi: ABIS[site.abi], functionName: site.functionName, args: site.args }),
      ).not.toThrow()
    })
  }
})
