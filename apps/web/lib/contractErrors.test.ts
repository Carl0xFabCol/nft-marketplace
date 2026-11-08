import { describe, expect, it } from "vitest"
import { ContractFunctionExecutionError, ContractFunctionRevertedError, UserRejectedRequestError, encodeErrorResult, erc721Abi, type Abi, type Hex } from "viem"
import { HypercAbi, LaunchPadAbi, MarketplaceBidsAbi, MarketplaceCoreAbi, MarketplaceRouterAbi } from "@marketplace/contracts/abis/web"
import { CONTRACT_ERROR_MESSAGES, contractErrorMessage, contractErrorName, type ContractErrorName } from "./contractErrors"
import { ChainGuardError } from "./chainGuard"
import { BidAcceptanceError } from "./bidAcceptance"

const ALL = [MarketplaceRouterAbi, MarketplaceCoreAbi, MarketplaceBidsAbi, LaunchPadAbi, HypercAbi] as readonly (readonly { type: string; name?: string }[])[]
const generatedErrorNames = new Set(ALL.flatMap((abi) => abi.filter((i) => i.type === "error").map((i) => i.name!)))

/** What wagmi/viem throw when a write reverts during gas estimation/simulation. */
function revert(abi: Abi, data: Hex, functionName: string) {
  const cause = new ContractFunctionRevertedError({ abi, data, functionName })
  return new ContractFunctionExecutionError(cause, { abi, functionName, args: [] })
}

describe("contract error messages (ABI-6)", () => {
  it("has a message for exactly every custom error in the generated ABIs", () => {
    expect(new Set(Object.keys(CONTRACT_ERROR_MESSAGES))).toEqual(generatedErrorNames)
    expect(generatedErrorNames.size).toBe(70)
    for (const msg of Object.values(CONTRACT_ERROR_MESSAGES)) expect(msg.length).toBeGreaterThan(10)
  })

  it("the name type is a closed union, not string", () => {
    // @ts-expect-error not a contract error
    const bad: ContractErrorName = "NotARealError"
    expect(bad).toBe("NotARealError")
  })

  it("decodes errors that bubble from Bids/Core through the router", () => {
    for (const [errorName, fragment] of [
      ["SellerProceedsTooLow", "proceeds would be lower"],
      ["RoyaltyExceedsPrice", "royalty exceed"],
      ["InsufficientGas", "ran out of gas"],
      ["CorePaused", "paused"],
      ["PriceTooLow", "lower than the price"],
      ["NotApproved", "not approved"],
    ] as const) {
      const data = encodeErrorResult({ abi: MarketplaceRouterAbi, errorName })
      const err = revert(MarketplaceRouterAbi as Abi, data, "acceptTokenBid")
      expect(contractErrorName(err)).toBe(errorName)
      expect(contractErrorMessage(err)).toContain(fragment)
    }
  })

  it("names a known error even when the call used a narrower ABI (raw revert data)", () => {
    // e.g. a Core error surfacing through a call made with viem's erc721Abi.
    const data = encodeErrorResult({ abi: MarketplaceCoreAbi, errorName: "CollectionNotRegistered" })
    const err = revert(erc721Abi as Abi, data, "setApprovalForAll")
    expect(contractErrorName(err)).toBe("CollectionNotRegistered")
    expect(contractErrorMessage(err)).toBe(CONTRACT_ERROR_MESSAGES.CollectionNotRegistered)
  })

  it("maps wallet rejection, guard and quote refusals; never echoes raw data", () => {
    const rejected = new ContractFunctionExecutionError(new UserRejectedRequestError(new Error("User denied")), { abi: [], functionName: "buy", args: [] })
    expect(contractErrorMessage(rejected)).toBe("You rejected the request in your wallet.")
    expect(contractErrorMessage(new ChainGuardError("Wrong network: switch"))).toBe("Wrong network: switch")
    expect(contractErrorMessage(new BidAcceptanceError("bid_changed", "This bid changed"))).toBe("This bid changed")
    expect(contractErrorMessage(revert(MarketplaceRouterAbi as Abi, "0xdeadbeef", "buy"))).toBe("The transaction failed.")
    expect(contractErrorMessage(new Error("Transaction reverted on-chain"))).toBe("The transaction reverted on-chain.")
    expect(contractErrorMessage(new Error("internal detail 0x1234"))).toBe("The transaction failed.")
  })
})
