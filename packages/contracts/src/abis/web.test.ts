import { describe, expect, it } from "vitest"
import { decodeErrorResult, encodeErrorResult, toFunctionSelector } from "viem"
import { MarketplaceBidsAbi, MarketplaceCoreAbi, MarketplaceAbi } from "./full.generated"
import { MarketplaceRouterAbi, errorSignature } from "./web"

type AbiError = { type: "error"; name: string; inputs: readonly { type: string }[] }

const errorsOf = (abi: readonly { type: string }[]) => abi.filter((i) => i.type === "error") as unknown as AbiError[]

describe("web ABI bundle", () => {
  it("contains every router function and event unchanged", () => {
    const nonErrors = (abi: readonly { type: string }[]) => abi.filter((i) => i.type !== "error")
    expect(nonErrors(MarketplaceRouterAbi)).toEqual(nonErrors(MarketplaceAbi))
  })

  it("contains every Core and Bids error (by signature)", () => {
    const have = new Set(errorsOf(MarketplaceRouterAbi).map(errorSignature))
    for (const e of [...errorsOf(MarketplaceCoreAbi), ...errorsOf(MarketplaceBidsAbi)]) {
      expect(have.has(errorSignature(e)), errorSignature(e)).toBe(true)
    }
  })

  it("has unique error selectors (no ambiguous decode)", () => {
    const sigs = errorsOf(MarketplaceRouterAbi).map(errorSignature)
    expect(new Set(sigs).size).toBe(sigs.length)
    const selectors = sigs.map((s) => toFunctionSelector(s))
    expect(new Set(selectors).size).toBe(selectors.length)
  })

  it("lets viem name errors that bubble from Bids and Core", () => {
    for (const errorName of ["SellerProceedsTooLow", "RoyaltyExceedsPrice", "InsufficientGas", "CorePaused", "PriceTooLow"] as const) {
      const data = encodeErrorResult({ abi: MarketplaceRouterAbi, errorName })
      expect(decodeErrorResult({ abi: MarketplaceRouterAbi, data }).errorName).toBe(errorName)
    }
  })
})
