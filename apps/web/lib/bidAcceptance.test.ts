import { describe, expect, it } from "vitest"
import { encodeAbiParameters, encodeFunctionData, type Address, type Hex } from "viem"
import { MarketplaceAbi } from "@marketplace/contracts/abis/generated/full"
import {
  BidAcceptanceError,
  DEFAULT_SLIPPAGE_BPS,
  UINT128_MAX,
  acceptBounds,
  applySlippage,
  marketplaceFeeOf,
  quoteCollectionBid,
  quoteTokenBid,
  resolveRoyalty,
  type QuoteReader,
} from "./bidAcceptance"

const B = BigInt
const ETH = B(10) ** B(18)
const ROUTER = "0x00000000000000000000000000000000000000a1" as Address
const COLLECTION = "0x00000000000000000000000000000000000000c1" as Address
const BIDDER = "0x00000000000000000000000000000000000000b1" as Address
const RECEIVER = "0x00000000000000000000000000000000000000d1" as Address
const ERC_RECEIVER = "0x00000000000000000000000000000000000000e1" as Address
const ZERO = "0x0000000000000000000000000000000000000000" as Address
const NOW = B(1_800_000_000)

const word = (v: bigint) => encodeAbiParameters([{ type: "uint256" }], [v])
const two = (a: Address, v: bigint) => encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a, v])

interface FakeChain {
  feeBps?: number
  overridden?: boolean
  coreReceiver?: Address
  coreFeeBps?: number
  tokenBid?: { price: bigint; expiresAt?: bigint }
  collectionBid?: { pricePerItem: bigint; quantity: number; expiresAt?: bigint }
  /** Raw returndata (or "revert") for supportsInterface / royaltyInfo(tokenId). */
  supports?: Hex | "revert"
  royaltyInfo?: (tokenId: bigint, price: bigint) => Hex | "revert"
}

function fakeReader(c: FakeChain): QuoteReader & { calls: string[] } {
  const calls: string[] = []
  const reader = {
    calls,
    readContract: async ({ functionName }: { functionName: string }) => {
      calls.push(functionName)
      switch (functionName) {
        case "marketplaceFee":
          return c.feeBps ?? 250
        case "royaltyOverridden":
          return c.overridden ?? false
        case "collections":
          return { royaltyReceiver: c.coreReceiver ?? RECEIVER, royaltyFee: c.coreFeeBps ?? 500, totalVolume: B(0), totalSales: 0, isVerified: false, exists: true }
        case "tokenBids":
          return { bidder: BIDDER, price: c.tokenBid?.price ?? B(0), expiresAt: c.tokenBid?.expiresAt ?? B(0) }
        case "collectionBids":
          return { bidder: BIDDER, pricePerItem: c.collectionBid?.pricePerItem ?? B(0), quantity: c.collectionBid?.quantity ?? 0, expiresAt: c.collectionBid?.expiresAt ?? B(0) }
        default:
          throw new Error(`unexpected read ${functionName}`)
      }
    },
    call: async ({ data }: { data: Hex }) => {
      if (data.startsWith("0x01ffc9a7")) {
        calls.push("supportsInterface")
        const r = c.supports ?? word(B(0))
        if (r === "revert") throw new Error("revert")
        return { data: r }
      }
      if (data.startsWith("0x2a55205a")) {
        calls.push("royaltyInfo")
        const tokenId = BigInt(`0x${data.slice(10, 74)}`)
        const price = BigInt(`0x${data.slice(74, 138)}`)
        const r = c.royaltyInfo ? c.royaltyInfo(tokenId, price) : "revert"
        if (r === "revert") throw new Error("revert")
        return { data: r }
      }
      throw new Error("unexpected call")
    },
  }
  return reader as unknown as QuoteReader & { calls: string[] }
}

const tokenParams = (shownPrice: bigint) => ({ router: ROUTER, collection: COLLECTION, tokenId: B(7), bidder: BIDDER, shownPrice, nowSec: NOW })

describe("applySlippage", () => {
  it("is the identity at the default 0 bps", () => {
    expect(DEFAULT_SLIPPAGE_BPS).toBe(B(0))
    for (const v of [B(0), B(1), B(999), ETH, UINT128_MAX]) expect(applySlippage(v, B(0))).toBe(v)
  })

  it("rounds down (a lower bound) and is exact on bigints beyond 2^53", () => {
    expect(applySlippage(B(1), B(1))).toBe(B(0)) // 0.9999 wei → 0
    expect(applySlippage(B(10_001), B(1))).toBe(B(9_999)) // 9999.9999 → 9999
    expect(applySlippage(B("1234567890123456789"), B(50))).toBe(B("1228395050672839505"))
    expect(applySlippage(UINT128_MAX, B(10_000))).toBe(B(0))
  })

  it("rejects out-of-range bps and negative amounts", () => {
    expect(() => applySlippage(ETH, B(-1))).toThrow(BidAcceptanceError)
    expect(() => applySlippage(ETH, B(10_001))).toThrow(BidAcceptanceError)
    expect(() => applySlippage(B(-1), B(0))).toThrow(BidAcceptanceError)
  })
})

describe("fee and royalty math (mirrors Core)", () => {
  it("fee floors like Solidity integer division", () => {
    expect(marketplaceFeeOf(B(399), B(250))).toBe(B(9)) // 9.975 → 9
    expect(marketplaceFeeOf(B(1), B(1000))).toBe(B(0))
    expect(marketplaceFeeOf(UINT128_MAX, B(1000))).toBe((UINT128_MAX * B(1000)) / B(10_000))
  })

  it("override: uses Core values even when ERC-2981 answers; zero receiver → 0", () => {
    const base = { price: B(10_000), overridden: true, coreReceiver: RECEIVER, coreFeeBps: B(300), erc2981: { receiver: ERC_RECEIVER, amount: B(1) } }
    expect(resolveRoyalty(base)).toEqual({ amount: B(300), source: "override" })
    expect(resolveRoyalty({ ...base, coreReceiver: ZERO })).toEqual({ amount: B(0), source: "override" })
  })

  it("ERC-2981 is used only with a non-zero receiver and amount ≤ 20% of price", () => {
    const base = { price: B(10_000), overridden: false, coreReceiver: RECEIVER, coreFeeBps: B(300) }
    expect(resolveRoyalty({ ...base, erc2981: { receiver: ERC_RECEIVER, amount: B(2_000) } })).toEqual({ amount: B(2_000), source: "erc2981" })
    expect(resolveRoyalty({ ...base, erc2981: { receiver: ERC_RECEIVER, amount: B(2_001) } })).toEqual({ amount: B(300), source: "collection" })
    expect(resolveRoyalty({ ...base, erc2981: { receiver: ZERO, amount: B(5) } })).toEqual({ amount: B(300), source: "collection" })
    expect(resolveRoyalty({ ...base, erc2981: null, coreReceiver: ZERO })).toEqual({ amount: B(0), source: "collection" })
  })
})

describe("quoteTokenBid", () => {
  it("quotes price - fee - royalty from on-chain terms (ERC-2981 path)", async () => {
    const price = B("1234567890123456789")
    const reader = fakeReader({
      feeBps: 250,
      tokenBid: { price },
      supports: word(B(1)),
      royaltyInfo: (_, p) => two(ERC_RECEIVER, (p * B(500)) / B(10_000)),
    })
    const q = await quoteTokenBid(reader, tokenParams(price))
    const fee = (price * B(250)) / B(10_000)
    const royalty = (price * B(500)) / B(10_000)
    expect(q).toMatchObject({ kind: "token", price, total: price, marketplaceFee: fee, royalty, royaltySources: ["erc2981"], proceeds: price - fee - royalty })
    expect(acceptBounds(q, DEFAULT_SLIPPAGE_BPS)).toEqual({ minPrice: price, minSellerProceeds: price - fee - royalty })
  })

  it("falls back to Core values when ERC-2981 is unsupported, reverts or returns malformed data", async () => {
    const price = ETH
    const expected = price - (price * B(250)) / B(10_000) - (price * B(500)) / B(10_000)
    const variants: FakeChain[] = [
      { supports: word(B(0)) },
      { supports: "revert" },
      { supports: word(B(2)) }, // Core requires word == 1 exactly
      { supports: word(B(1)), royaltyInfo: () => "revert" },
      { supports: word(B(1)), royaltyInfo: () => `${two(ERC_RECEIVER, B(1))}00` as Hex }, // wrong returndatasize
      { supports: word(B(1)), royaltyInfo: () => `0x${"f".repeat(64)}${"0".repeat(64)}` as Hex }, // dirty address word
    ]
    for (const v of variants) {
      const q = await quoteTokenBid(fakeReader({ ...v, tokenBid: { price } }), tokenParams(price))
      expect(q.royaltySources).toEqual(["collection"])
      expect(q.proceeds).toBe(expected)
    }
  })

  it("does not query ERC-2981 when the Core royalty is overridden", async () => {
    const reader = fakeReader({ overridden: true, coreFeeBps: 1000, tokenBid: { price: ETH }, supports: word(B(1)), royaltyInfo: () => two(ERC_RECEIVER, B(0)) })
    const q = await quoteTokenBid(reader, tokenParams(ETH))
    expect(q.royalty).toBe(ETH / B(10))
    expect(reader.calls).not.toContain("supportsInterface")
  })

  it("refuses before the wallet when the bid changed, vanished or expired", async () => {
    await expect(quoteTokenBid(fakeReader({ tokenBid: { price: ETH } }), tokenParams(ETH - B(1)))).rejects.toMatchObject({ code: "bid_changed" })
    await expect(quoteTokenBid(fakeReader({ tokenBid: { price: ETH + B(1) } }), tokenParams(ETH))).rejects.toMatchObject({ code: "bid_changed" })
    await expect(quoteTokenBid(fakeReader({}), tokenParams(ETH))).rejects.toMatchObject({ code: "bid_not_found" })
    await expect(quoteTokenBid(fakeReader({ tokenBid: { price: ETH, expiresAt: NOW } }), tokenParams(ETH))).rejects.toMatchObject({ code: "bid_expired" })
    const q = await quoteTokenBid(fakeReader({ tokenBid: { price: ETH, expiresAt: NOW + B(1) } }), tokenParams(ETH))
    expect(q.price).toBe(ETH)
  })

  it("refuses when fee + royalty exceed the price (RoyaltyExceedsPrice)", async () => {
    // ERC-2981 is capped at 20%, so only an (admin-set) override can exceed: 10% fee + 95% royalty.
    const reader = fakeReader({ feeBps: 1000, overridden: true, coreFeeBps: 9_500, tokenBid: { price: B(100) } })
    await expect(quoteTokenBid(reader, tokenParams(B(100)))).rejects.toMatchObject({ code: "royalty_exceeds_price" })
  })

  it("handles the uint128 edge without precision loss", async () => {
    const price = UINT128_MAX
    const q = await quoteTokenBid(fakeReader({ feeBps: 1000, tokenBid: { price } }), tokenParams(price))
    expect(q.marketplaceFee).toBe((price * B(1000)) / B(10_000))
    expect(q.proceeds + q.marketplaceFee + q.royalty).toBe(price)
  })
})

describe("quoteCollectionBid", () => {
  const params = (tokenIds: bigint[], shownPricePerItem: bigint) => ({ router: ROUTER, collection: COLLECTION, bidder: BIDDER, tokenIds, shownPricePerItem, nowSec: NOW })

  it("sums fee and per-token ERC-2981 royalties like _executeCollectionBidSales", async () => {
    const ppi = B(1_000_003)
    const reader = fakeReader({
      feeBps: 250,
      collectionBid: { pricePerItem: ppi, quantity: 5 },
      supports: word(B(1)),
      royaltyInfo: (tokenId, p) => (tokenId === B(2) ? "revert" : two(ERC_RECEIVER, (p * B(700)) / B(10_000))),
    })
    const q = await quoteCollectionBid(reader, params([B(1), B(2), B(3)], ppi))
    const fee = ((ppi * B(250)) / B(10_000)) * B(3)
    const royalty = ((ppi * B(700)) / B(10_000)) * B(2) + (ppi * B(500)) / B(10_000)
    expect(q.total).toBe(ppi * B(3))
    expect(q.marketplaceFee).toBe(fee)
    expect(q.royalty).toBe(royalty)
    expect(q.royaltySources.sort()).toEqual(["collection", "erc2981"])
    expect(q.proceeds).toBe(ppi * B(3) - fee - royalty)
    // Per-item price is the bound, not the total.
    expect(acceptBounds(q, B(0)).minPrice).toBe(ppi)
  })

  it("refuses when the remaining quantity is too small, or the bid is gone or changed", async () => {
    await expect(quoteCollectionBid(fakeReader({ collectionBid: { pricePerItem: ETH, quantity: 1 } }), params([B(1), B(2)], ETH))).rejects.toMatchObject({ code: "insufficient_quantity" })
    await expect(quoteCollectionBid(fakeReader({}), params([B(1)], ETH))).rejects.toMatchObject({ code: "bid_not_found" })
    await expect(quoteCollectionBid(fakeReader({ collectionBid: { pricePerItem: ETH, quantity: 2 } }), params([B(1)], ETH - B(1)))).rejects.toMatchObject({ code: "bid_changed" })
    await expect(quoteCollectionBid(fakeReader({ collectionBid: { pricePerItem: ETH, quantity: 2 } }), params([], ETH))).rejects.toMatchObject({ code: "insufficient_quantity" })
  })
})

describe("accept args encode against the generated router ABI", () => {
  it("acceptTokenBid and acceptCollectionBid take the bounds in the right slots", async () => {
    const q = await quoteTokenBid(fakeReader({ tokenBid: { price: ETH } }), tokenParams(ETH))
    const { minPrice, minSellerProceeds } = acceptBounds(q, DEFAULT_SLIPPAGE_BPS)
    const data = encodeFunctionData({ abi: MarketplaceAbi, functionName: "acceptTokenBid", args: [COLLECTION, B(7), BIDDER, minPrice, minSellerProceeds] })
    expect(data.endsWith(minSellerProceeds.toString(16).padStart(64, "0"))).toBe(true)
    expect(() =>
      encodeFunctionData({ abi: MarketplaceAbi, functionName: "acceptCollectionBid", args: [COLLECTION, BIDDER, [B(1)], minPrice, minSellerProceeds] }),
    ).not.toThrow()
  })
})
