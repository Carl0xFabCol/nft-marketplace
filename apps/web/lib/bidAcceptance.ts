// lib/bidAcceptance.ts
//
// Exact seller-side quote for accepting a token/collection bid, and the
// slippage bounds passed to `acceptTokenBid(…, minPrice, minSellerProceeds)` /
// `acceptCollectionBid(…, minPricePerItem, minSellerProceeds)` (ABI-1).
//
// Everything is bigint. The math mirrors the contracts line by line:
//   fee       = price * marketplaceFee / 10_000            (Core.executeSaleFromBid)
//   royalty   = Core._getRoyalty(collection, tokenId, price)
//   proceeds  = price - fee - royalty                      (Bids.acceptTokenBid)
//   collection bids: every token is a separate executeSaleFromBid at
//   pricePerItem, so fee and royalty are summed per token (per-token ERC-2981).
//
// Known divergence (fail-closed): on-chain ERC-2981 queries run under a 50k gas
// cap; this quote runs them uncapped. A collection that answers here but runs
// out of gas on-chain makes Core fall back to its stored royalty. If that is
// larger, the tx reverts with SellerProceedsTooLow; if smaller, the seller gets
// more than quoted. Never less than shown.

import { encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient } from "viem"
import { MarketplaceABI } from "@/lib/abi"

export const BPS = BigInt(10_000)
/** Core.MAX_ROYALTY_FEE (20%). */
export const MAX_ROYALTY_BPS = BigInt(2_000)
export const UINT128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1)
/** IERC2981 interface id. */
export const ERC2981_INTERFACE_ID = "0x2a55205a" as const
/** No tolerance (product decision 2026-11-08). The only default; see hooks/useSlippageBps.ts. */
export const DEFAULT_SLIPPAGE_BPS = BigInt(0)

const ZERO = BigInt(0)
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

export type BidAcceptanceErrorCode =
  | "bid_not_found"
  | "bid_changed"
  | "bid_expired"
  | "insufficient_quantity"
  | "royalty_exceeds_price"
  | "out_of_range"
  | "invalid_slippage"

export class BidAcceptanceError extends Error {
  constructor(
    readonly code: BidAcceptanceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "BidAcceptanceError"
  }
}

// ─── Pure math ──────────────────────────────────────────────────────────────

/**
 * Lower bound after `bps` of tolerance, rounded down: amount * (10_000 - bps) / 10_000.
 * bps = 0 returns `amount` unchanged (exact bound).
 */
export function applySlippage(amount: bigint, slippageBps: bigint): bigint {
  if (slippageBps < ZERO || slippageBps > BPS) {
    throw new BidAcceptanceError("invalid_slippage", "Slippage must be between 0 and 10000 basis points.")
  }
  if (amount < ZERO) throw new BidAcceptanceError("out_of_range", "Amount cannot be negative.")
  if (slippageBps === ZERO) return amount
  return (amount * (BPS - slippageBps)) / BPS
}

/** Core: SafeCast.toUint128((price * marketplaceFee) / BASIS_POINTS). */
export function marketplaceFeeOf(price: bigint, feeBps: bigint): bigint {
  return (price * feeBps) / BPS
}

export type RoyaltySource = "override" | "erc2981" | "collection"

export interface RoyaltyInputs {
  price: bigint
  /** Core.royaltyOverridden(collection). */
  overridden: boolean
  /** Core.collections(collection).royaltyReceiver / royaltyFee. */
  coreReceiver: Address
  coreFeeBps: bigint
  /**
   * The collection's ERC-2981 answer, already filtered the way Core filters it
   * (exact return size, address word). `null` when unsupported or unusable.
   */
  erc2981: { receiver: Address; amount: bigint } | null
}

/** Mirrors MarketplaceCore._getRoyalty. */
export function resolveRoyalty(i: RoyaltyInputs): { amount: bigint; source: RoyaltySource } {
  if (i.overridden) {
    const amount = isZeroAddress(i.coreReceiver) ? ZERO : (i.price * i.coreFeeBps) / BPS
    return { amount, source: "override" }
  }
  if (i.erc2981) {
    const maxRoyalty = (i.price * MAX_ROYALTY_BPS) / BPS
    if (!isZeroAddress(i.erc2981.receiver) && i.erc2981.amount <= maxRoyalty) {
      return { amount: i.erc2981.amount, source: "erc2981" }
    }
  }
  const amount = isZeroAddress(i.coreReceiver) ? ZERO : (i.price * i.coreFeeBps) / BPS
  return { amount, source: "collection" }
}

/** One executeSaleFromBid: fee, royalty, and the RoyaltyExceedsPrice check. */
export function saleSplit(price: bigint, feeBps: bigint, royalty: { amount: bigint; source: RoyaltySource }) {
  const fee = marketplaceFeeOf(price, feeBps)
  if (fee + royalty.amount > price) {
    throw new BidAcceptanceError("royalty_exceeds_price", "Fees and royalty exceed the bid price; this sale would revert (RoyaltyExceedsPrice).")
  }
  return { fee, royalty: royalty.amount, royaltySource: royalty.source }
}

function isZeroAddress(a: string): boolean {
  return a.toLowerCase() === ZERO_ADDRESS
}

function requireUint128(value: bigint, what: string): bigint {
  if (value < ZERO || value > UINT128_MAX) throw new BidAcceptanceError("out_of_range", `${what} is out of the uint128 range.`)
  return value
}

// ─── Quote ──────────────────────────────────────────────────────────────────

export interface AcceptQuote {
  kind: "token" | "collection"
  collection: Address
  bidder: Address
  tokenIds: bigint[]
  /** Bid price per item, as shown to the seller (== on-chain bid price). */
  price: bigint
  /** price * tokenIds.length */
  total: bigint
  marketplaceFeeBps: bigint
  marketplaceFee: bigint
  royalty: bigint
  /** Distinct sources across the tokens (usually one). */
  royaltySources: RoyaltySource[]
  /** total - marketplaceFee - royalty: what the seller is credited. */
  proceeds: bigint
}

export type QuoteReader = Pick<PublicClient, "readContract" | "call">

const erc2981Abi = parseAbi([
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address receiver, uint256 royaltyAmount)",
])

/** Raw eth_call; undefined when it reverts or returns nothing. */
async function rawCall(reader: QuoteReader, to: Address, data: Hex): Promise<Hex | undefined> {
  try {
    const res = await reader.call({ to, data })
    return res.data
  } catch {
    return undefined
  }
}

const WORD_HEX = 64
const ADDRESS_HIGH_BITS = /^0{24}$/

/**
 * The collection's ERC-2981 answer, filtered exactly like Core:
 * supportsInterface returns exactly one word equal to 1, royaltyInfo returns
 * exactly two words, and the first one is a clean address word.
 */
export async function readErc2981(reader: QuoteReader, collection: Address, tokenId: bigint, price: bigint): Promise<RoyaltyInputs["erc2981"]> {
  const supports = await rawCall(
    reader,
    collection,
    encodeFunctionData({ abi: erc2981Abi, functionName: "supportsInterface", args: [ERC2981_INTERFACE_ID] }),
  )
  if (!supports || supports.length !== 2 + WORD_HEX || BigInt(supports) !== BigInt(1)) return null

  const info = await rawCall(reader, collection, encodeFunctionData({ abi: erc2981Abi, functionName: "royaltyInfo", args: [tokenId, price] }))
  if (!info || info.length !== 2 + 2 * WORD_HEX) return null
  const receiverWord = info.slice(2, 2 + WORD_HEX)
  if (!ADDRESS_HIGH_BITS.test(receiverWord.slice(0, 24))) return null
  return {
    receiver: `0x${receiverWord.slice(24)}` as Address,
    amount: BigInt(`0x${info.slice(2 + WORD_HEX)}`),
  }
}

interface MarketTerms {
  feeBps: bigint
  overridden: boolean
  coreReceiver: Address
  coreFeeBps: bigint
}

async function readMarketTerms(reader: QuoteReader, router: Address, collection: Address): Promise<MarketTerms> {
  const [feeBps, overridden, info] = await Promise.all([
    reader.readContract({ address: router, abi: MarketplaceABI, functionName: "marketplaceFee" }),
    reader.readContract({ address: router, abi: MarketplaceABI, functionName: "royaltyOverridden", args: [collection] }),
    reader.readContract({ address: router, abi: MarketplaceABI, functionName: "collections", args: [collection] }),
  ])
  return { feeBps: BigInt(feeBps), overridden, coreReceiver: info.royaltyReceiver, coreFeeBps: BigInt(info.royaltyFee) }
}

async function splitFor(reader: QuoteReader, terms: MarketTerms, collection: Address, tokenId: bigint, price: bigint) {
  const erc2981 = terms.overridden ? null : await readErc2981(reader, collection, tokenId, price)
  const royalty = resolveRoyalty({ price, overridden: terms.overridden, coreReceiver: terms.coreReceiver, coreFeeBps: terms.coreFeeBps, erc2981 })
  return saleSplit(price, terms.feeBps, royalty)
}

function assertNotExpired(expiresAt: bigint, nowSec: bigint) {
  if (expiresAt !== ZERO && expiresAt <= nowSec) throw new BidAcceptanceError("bid_expired", "This bid has expired.")
}

function assertShownPrice(onChain: bigint, shown: bigint) {
  if (onChain !== shown) {
    throw new BidAcceptanceError("bid_changed", "This bid changed on-chain since the page loaded. Refresh and review the new price.")
  }
}

export interface QuoteTokenBidParams {
  router: Address
  collection: Address
  tokenId: bigint
  bidder: Address
  /** Exact wei the UI displays for this bid (from the DB, read as text). */
  shownPrice: bigint
  nowSec?: bigint
}

export async function quoteTokenBid(reader: QuoteReader, p: QuoteTokenBidParams): Promise<AcceptQuote> {
  const bid = await reader.readContract({ address: p.router, abi: MarketplaceABI, functionName: "tokenBids", args: [p.collection, p.tokenId, p.bidder] })
  if (bid.price === ZERO) throw new BidAcceptanceError("bid_not_found", "This bid no longer exists on-chain.")
  assertShownPrice(bid.price, p.shownPrice)
  assertNotExpired(BigInt(bid.expiresAt), p.nowSec ?? nowSeconds())

  const price = requireUint128(bid.price, "Bid price")
  const terms = await readMarketTerms(reader, p.router, p.collection)
  const split = await splitFor(reader, terms, p.collection, p.tokenId, price)

  return {
    kind: "token",
    collection: p.collection,
    bidder: p.bidder,
    tokenIds: [p.tokenId],
    price,
    total: price,
    marketplaceFeeBps: terms.feeBps,
    marketplaceFee: split.fee,
    royalty: split.royalty,
    royaltySources: [split.royaltySource],
    proceeds: price - split.fee - split.royalty,
  }
}

export interface QuoteCollectionBidParams {
  router: Address
  collection: Address
  bidder: Address
  tokenIds: bigint[]
  /** Exact wei per item the UI displays for this bid. */
  shownPricePerItem: bigint
  nowSec?: bigint
}

export async function quoteCollectionBid(reader: QuoteReader, p: QuoteCollectionBidParams): Promise<AcceptQuote> {
  if (p.tokenIds.length === 0) throw new BidAcceptanceError("insufficient_quantity", "Select at least one token.")
  const bid = await reader.readContract({ address: p.router, abi: MarketplaceABI, functionName: "collectionBids", args: [p.collection, p.bidder] })
  if (bid.quantity === 0) throw new BidAcceptanceError("bid_not_found", "This collection bid no longer exists on-chain.")
  assertShownPrice(bid.pricePerItem, p.shownPricePerItem)
  assertNotExpired(BigInt(bid.expiresAt), p.nowSec ?? nowSeconds())
  if (p.tokenIds.length > bid.quantity) {
    throw new BidAcceptanceError("insufficient_quantity", `This bid only covers ${bid.quantity} more item(s).`)
  }

  const price = requireUint128(bid.pricePerItem, "Bid price")
  const total = requireUint128(price * BigInt(p.tokenIds.length), "Total price")
  const terms = await readMarketTerms(reader, p.router, p.collection)

  let fee = ZERO
  let royalty = ZERO
  const sources = new Set<RoyaltySource>()
  for (const tokenId of p.tokenIds) {
    const split = await splitFor(reader, terms, p.collection, tokenId, price)
    fee += split.fee
    royalty += split.royalty
    sources.add(split.royaltySource)
  }

  return {
    kind: "collection",
    collection: p.collection,
    bidder: p.bidder,
    tokenIds: [...p.tokenIds],
    price,
    total,
    marketplaceFeeBps: terms.feeBps,
    marketplaceFee: fee,
    royalty,
    royaltySources: [...sources],
    proceeds: total - fee - royalty,
  }
}

/**
 * Contract bounds for a quote: minPrice (per item) and minSellerProceeds.
 * With the default 0 bps they equal exactly what the seller was shown.
 */
export function acceptBounds(quote: AcceptQuote, slippageBps: bigint): { minPrice: bigint; minSellerProceeds: bigint } {
  return {
    minPrice: requireUint128(applySlippage(quote.price, slippageBps), "minPrice"),
    minSellerProceeds: requireUint128(applySlippage(quote.proceeds, slippageBps), "minSellerProceeds"),
  }
}

function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000))
}
