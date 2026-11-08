// ─────────────────────────────────────────────────────────────────────────────
// Web ABI bundle (hand-written composition of GENERATED ABIs only).
//
// The web app only ever calls the Marketplace router. Core and Bids revert
// data bubbles up through the router unchanged (plain high-level calls), so
// a revert like `SellerProceedsTooLow()` (Bids) or `RoyaltyExceedsPrice()`
// (Core) arrives at the wallet with a selector the router ABI does not
// declare. viem can only name an error that is in the ABI passed to
// readContract/writeContract/simulateContract, so the router ABI is extended
// with every Core/Bids error fragment, de-duplicated by signature.
//
// Never hand-edit fragments here: regenerate *.generated.ts instead.
// ─────────────────────────────────────────────────────────────────────────────
import { HypercAbi } from "./collection.generated"
import { MarketplaceAbi, MarketplaceBidsAbi, MarketplaceCoreAbi } from "./full.generated"
import { LaunchPadAbi } from "./launchpad.generated"

type AbiError = { type: "error"; name: string; inputs: readonly { type: string }[] }

type ErrorsOf<T extends readonly unknown[]> = Extract<T[number], { type: "error" }>

/** Canonical `Name(type,type)` signature of an error fragment. */
export function errorSignature(e: { name: string; inputs: readonly { type: string }[] }): string {
  return `${e.name}(${e.inputs.map((i) => i.type).join(",")})`
}

function componentErrors<T extends readonly unknown[]>(...abis: T[]): ErrorsOf<T>[] {
  const seen = new Set<string>()
  const out: ErrorsOf<T>[] = []
  for (const abi of abis) {
    for (const item of abi as readonly { type: string }[]) {
      if (item.type !== "error") continue
      const sig = errorSignature(item as unknown as AbiError)
      if (seen.has(sig)) continue
      seen.add(sig)
      out.push(item as ErrorsOf<T>)
    }
  }
  return out
}

const routerErrorSigs = new Set(
  (MarketplaceAbi as readonly { type: string }[])
    .filter((i) => i.type === "error")
    .map((i) => errorSignature(i as unknown as AbiError)),
)

/** Errors that Core/Bids can bubble through the router and the router ABI lacks. */
export const MarketplaceComponentErrorsAbi = componentErrors<typeof MarketplaceCoreAbi | typeof MarketplaceBidsAbi>(
  MarketplaceCoreAbi,
  MarketplaceBidsAbi,
).filter((e) => !routerErrorSigs.has(errorSignature(e as unknown as AbiError)))

/** Router ABI (functions, events, errors) plus every bubbling Core/Bids error. */
export const MarketplaceRouterAbi = [...MarketplaceAbi, ...MarketplaceComponentErrorsAbi] as const

export { HypercAbi, LaunchPadAbi, MarketplaceAbi, MarketplaceBidsAbi, MarketplaceCoreAbi }
