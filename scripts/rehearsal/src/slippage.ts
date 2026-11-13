// Step 7: the slippage proof no unit test can give. Every acceptance takes its
// bounds from the WEB's own code: quoteTokenBid / quoteCollectionBid +
// acceptBounds(quote, DEFAULT_SLIPPAGE_BPS) (apps/web/lib/bidAcceptance.ts),
// signs exactly that, and then checks the on-chain credit deltas against the
// quote to the wei. A stale quote must revert with SellerProceedsTooLow and the
// web mapper must turn it into the readable message.

import { parseEther, type Address } from "viem"
import { acceptBounds, BidAcceptanceError, DEFAULT_SLIPPAGE_BPS, quoteCollectionBid, quoteTokenBid, type AcceptQuote, type QuoteReader } from "@/lib/bidAcceptance"
import { CONTRACT_ERROR_MESSAGES, contractErrorMessage } from "@/lib/contractErrors"
import { account, MarketplaceRouterAbi, type Role } from "./chain"
import type { Ctx } from "./ctx"
import { must, mustRevert, now, router, type Inventory } from "./scenarios"

async function pending(c: Ctx, role: Role): Promise<bigint> {
  const [core, bids] = (await c.chain.pub.readContract({ address: c.addresses.router, abi: MarketplaceRouterAbi, functionName: "pendingWithdrawals", args: [account(role).address] })) as readonly [bigint, bigint]
  return core + bids
}

const reader = (c: Ctx) => c.chain.pub as unknown as QuoteReader

export interface SlippageCase {
  name: string
  kind: "token" | "collection"
  price: bigint
  tokens: number
  sources: string
  fee: bigint
  royalty: bigint
  proceeds: bigint
}
export const slippageCases: SlippageCase[] = []

/** Signs exactly the web quote and proves the credits equal it to the wei. */
async function acceptExact(c: Ctx, label: string, seller: Role, quote: AcceptQuote): Promise<void> {
  const bounds = acceptBounds(quote, DEFAULT_SLIPPAGE_BPS)
  c.log.eq(`${label}: 0-bps minPrice == price shown`, bounds.minPrice, quote.price)
  c.log.eq(`${label}: 0-bps minSellerProceeds == proceeds shown`, bounds.minSellerProceeds, quote.proceeds)

  const before = { seller: await pending(c, seller), fees: await pending(c, "fees"), royalty: await pending(c, "royalty") }
  const spec =
    quote.kind === "token"
      ? router(c, "acceptTokenBid", [quote.collection, quote.tokenIds[0], quote.bidder, bounds.minPrice, bounds.minSellerProceeds])
      : router(c, "acceptCollectionBid", [quote.collection, quote.bidder, quote.tokenIds, bounds.minPrice, bounds.minSellerProceeds])
  await must(c, `${label}: accept with the web's exact bounds`, seller, spec)
  const after = { seller: await pending(c, seller), fees: await pending(c, "fees"), royalty: await pending(c, "royalty") }

  c.log.eq(`${label}: seller credited exactly quote.proceeds`, after.seller - before.seller, quote.proceeds)
  c.log.eq(`${label}: fee receiver credited exactly quote.marketplaceFee`, after.fees - before.fees, quote.marketplaceFee)
  c.log.eq(`${label}: royalty receiver credited exactly quote.royalty`, after.royalty - before.royalty, quote.royalty)
  slippageCases.push({
    name: label,
    kind: quote.kind,
    price: quote.price,
    tokens: quote.tokenIds.length,
    sources: quote.royaltySources.join("+"),
    fee: quote.marketplaceFee,
    royalty: quote.royalty,
    proceeds: quote.proceeds,
  })
}

async function quoteToken(c: Ctx, collection: Address, tokenId: bigint, bidder: Role, shown: bigint): Promise<AcceptQuote> {
  return quoteTokenBid(reader(c), { router: c.addresses.router, collection, tokenId, bidder: account(bidder).address, shownPrice: shown, nowSec: await now(c) })
}

async function tokenCase(c: Ctx, label: string, collection: Address, tokenId: bigint, bidder: Role, price: bigint, expectSource: string) {
  await must(c, `${label}: ${bidder} bids ${price} wei on ${tokenId}`, bidder, router(c, "placeTokenBid", [collection, tokenId, price, 0n], price))
  const q = await quoteToken(c, collection, tokenId, bidder, price)
  c.log.eq(`${label}: royalty source`, q.royaltySources.join("+"), expectSource)
  await acceptExact(c, label, "alice", q)
}

export async function slippageProof(c: Ctx, inv: Inventory): Promise<void> {
  const { A, B, C, D } = c.collections
  const a = inv.A.alice
  const ODD = 1_234_567_890_123_456_789n

  // ERC-2981 (A: 500 bps), including the bid placed in the market scenarios.
  await acceptExact(c, "A ERC-2981, 0.5 ETH (carol's earlier bid)", "alice", await quoteToken(c, A, a[2], "carol", parseEther("0.5")))
  await tokenCase(c, "A ERC-2981, 1 wei", A, a[5], "bob", 1n, "erc2981")
  await tokenCase(c, "A ERC-2981, 3 wei", A, a[6], "bob", 3n, "erc2981")

  // Royalty override (A: 400 bps via Core) at an odd price.
  await must(c, "creator overrides A royalty → 400 bps", "creator", router(c, "updateCollectionRoyalty", [A, account("royalty").address, 400]))
  await tokenCase(c, "A override 400 bps, 1234567890123456789 wei", A, a[7], "bob", ODD, "override")
  await must(c, "owner clears the A override", "deployer", router(c, "clearRoyaltyOverride", [A]))

  // No ERC-2981: stored fallback (B: 200 bps), and no royalty at all (D: 0 bps).
  await tokenCase(c, "B stored 200 bps, 1e18+1 wei", B, 5n, "bob", 10n ** 18n + 1n, "collection")
  await tokenCase(c, "D no royalty, 1 wei", D, 1n, "bob", 1n, "collection")
  await tokenCase(c, "D no royalty, 1234567890123456789 wei", D, 2n, "bob", ODD, "collection")

  // LaunchPad collection (C: 750 bps ERC-2981).
  await tokenCase(c, "C launchpad ERC-2981, 3 wei", C, inv.C.alice[1], "bob", 3n, "erc2981")
  // A token bid accepted on a LISTED token (C#first is listed at 7 wei).
  await tokenCase(c, "C bid on a listed token, 1e18+7 wei", C, inv.C.alice[0], "bob", 10n ** 18n + 7n, "erc2981")

  // Collection bid with N tokens at an odd price (C).
  const cTokens = inv.C.alice.slice(3, 6)
  await must(c, "carol collection bid on C, odd price × 3", "carol", router(c, "placeCollectionBid", [C, ODD, 3, 0n], ODD * 3n))
  const qc = await quoteCollectionBid(reader(c), { router: c.addresses.router, collection: C, bidder: account("carol").address, tokenIds: cTokens, shownPricePerItem: ODD, nowSec: await now(c) })
  await acceptExact(c, "C collection bid, 3 tokens, odd price", "alice", qc)

  // Partial fill of carol's B collection bid (0.3 ETH × 3), on a LISTED token
  // (B#1) plus B#4, then the last unit by another seller.
  const qb = await quoteCollectionBid(reader(c), { router: c.addresses.router, collection: B, bidder: account("carol").address, tokenIds: [1n, 4n], shownPricePerItem: parseEther("0.3"), nowSec: await now(c) })
  await acceptExact(c, "B collection bid partial fill 2/3 (one listed token)", "alice", qb)
  const qb2 = await quoteCollectionBid(reader(c), { router: c.addresses.router, collection: B, bidder: account("carol").address, tokenIds: [9n], shownPricePerItem: parseEther("0.3"), nowSec: await now(c) })
  await acceptExact(c, "B collection bid final unit (dave)", "dave", qb2)

  await staleQuotes(c, inv)
}

/** Fee / royalty changed between quote and acceptance: must revert, readable message, and nothing sold. */
async function staleQuotes(c: Ctx, inv: Inventory): Promise<void> {
  const { A, D } = c.collections
  const a = inv.A.alice
  const expected = CONTRACT_ERROR_MESSAGES.SellerProceedsTooLow

  // 1. marketplace fee raised after the quote.
  await must(c, "stale-fee: bob bids 1 ETH on A", "bob", router(c, "placeTokenBid", [A, a[8], parseEther("1"), 0n], parseEther("1")))
  const q1 = await quoteToken(c, A, a[8], "bob", parseEther("1"))
  await must(c, "stale-fee: fee 250 → 500 after the quote", "deployer", router(c, "updateMarketplaceFee", [500]))
  const b1 = acceptBounds(q1, DEFAULT_SLIPPAGE_BPS)
  const m1 = await mustRevert(c, "stale-fee: accept with the stale quote", "alice", router(c, "acceptTokenBid", [A, a[8], account("bob").address, b1.minPrice, b1.minSellerProceeds]), "SellerProceedsTooLow")
  c.log.eq("stale-fee: web mapper message", m1, expected)
  c.log.eq("stale-fee: nothing sold (alice still owns the token)", await ownerOf(c, A, a[8]), account("alice").address)
  await must(c, "stale-fee: fee back to 250", "deployer", router(c, "updateMarketplaceFee", [250]))
  await acceptExact(c, "stale-fee: re-quoted acceptance", "alice", await quoteToken(c, A, a[8], "bob", parseEther("1")))

  // 2. royalty override raised after the quote.
  await must(c, "stale-royalty: bob bids 1 ETH on A", "bob", router(c, "placeTokenBid", [A, a[9], parseEther("1"), 0n], parseEther("1")))
  const q2 = await quoteToken(c, A, a[9], "bob", parseEther("1"))
  await must(c, "stale-royalty: creator overrides A → 1000 bps after the quote", "creator", router(c, "updateCollectionRoyalty", [A, account("royalty").address, 1000]))
  const b2 = acceptBounds(q2, DEFAULT_SLIPPAGE_BPS)
  const m2 = await mustRevert(c, "stale-royalty: accept with the stale quote", "alice", router(c, "acceptTokenBid", [A, a[9], account("bob").address, b2.minPrice, b2.minSellerProceeds]), "SellerProceedsTooLow")
  c.log.eq("stale-royalty: web mapper message", m2, expected)
  await must(c, "stale-royalty: owner clears the override", "deployer", router(c, "clearRoyaltyOverride", [A]))
  await acceptExact(c, "stale-royalty: re-quoted acceptance", "alice", await quoteToken(c, A, a[9], "bob", parseEther("1")))

  // 3. the bid itself lowered after the quote: minPrice protects (PriceTooLow),
  //    and the web quote refuses a changed bid before the wallet prompt.
  await must(c, "stale-price: bob bids 1 ETH on D#3", "bob", router(c, "placeTokenBid", [D, 3n, parseEther("1"), 0n], parseEther("1")))
  const q3 = await quoteToken(c, D, 3n, "bob", parseEther("1"))
  await must(c, "stale-price: bob replaces it with 0.5 ETH", "bob", router(c, "placeTokenBid", [D, 3n, parseEther("0.5"), 0n], parseEther("0.5")))
  const b3 = acceptBounds(q3, DEFAULT_SLIPPAGE_BPS)
  const m3 = await mustRevert(c, "stale-price: accept with the stale quote", "alice", router(c, "acceptTokenBid", [D, 3n, account("bob").address, b3.minPrice, b3.minSellerProceeds]), "PriceTooLow")
  c.log.eq("stale-price: web mapper message", m3, CONTRACT_ERROR_MESSAGES.PriceTooLow)
  const refused = await quoteToken(c, D, 3n, "bob", parseEther("1")).then(
    () => "quoted",
    (e: unknown) => (e instanceof BidAcceptanceError ? e.code : String(e)),
  )
  c.log.eq("stale-price: the web quote refuses a changed bid (bid_changed)", refused, "bid_changed")
  c.log.check("stale-price: refusal message is readable", contractErrorMessage(new BidAcceptanceError("bid_changed", "x")) === "x")
}

async function ownerOf(c: Ctx, collection: Address, tokenId: bigint): Promise<Address> {
  return (await c.chain.pub.readContract({
    address: collection,
    abi: [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256", name: "id" }], outputs: [{ type: "address", name: "" }] }] as const,
    functionName: "ownerOf",
    args: [tokenId],
  })) as Address
}
