// lib/contractErrors.ts
//
// Readable messages for contract reverts (ABI-6). Write hooks pass the
// generated ABIs (the router ABI is extended with every Core/Bids error, see
// @marketplace/contracts/abis/web), so viem decodes custom errors by name.
// CONTRACT_ERROR_MESSAGES is typed against the union of error names of ALL
// generated ABIs: a new or renamed contract error fails the typecheck until it
// gets a message here.

import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, decodeErrorResult, type Hex } from "viem"
import { HypercAbi, LaunchPadAbi, MarketplaceBidsAbi, MarketplaceCoreAbi, MarketplaceRouterAbi } from "@marketplace/contracts/abis/web"
import { BidAcceptanceError } from "@/lib/bidAcceptance"
import { chainGuardErrorMessage } from "@/lib/chainGuard"

type ErrorNames<T extends readonly unknown[]> = Extract<T[number], { type: "error" }> extends { name: infer N } ? N : never

export type ContractErrorName =
  | ErrorNames<typeof MarketplaceRouterAbi>
  | ErrorNames<typeof MarketplaceCoreAbi>
  | ErrorNames<typeof MarketplaceBidsAbi>
  | ErrorNames<typeof LaunchPadAbi>
  | ErrorNames<typeof HypercAbi>

export const CONTRACT_ERROR_MESSAGES: Record<ContractErrorName, string> = {
  // ── Bid acceptance / bids ────────────────────────────────────────────────
  SellerProceedsTooLow: "Your proceeds would be lower than shown (the marketplace fee or royalty changed). Nothing was sold. Review the new amounts and try again.",
  PriceTooLow: "The bid is now lower than the price you were shown. Nothing was sold. Refresh to see the current bid.",
  RoyaltyExceedsPrice: "The marketplace fee plus the royalty exceed the sale price, so this sale cannot go through.",
  BidNotFound: "This bid no longer exists (it was cancelled, accepted or replaced).",
  BidExpired: "This bid has expired.",
  InvalidQuantity: "This collection bid does not cover that many items any more.",
  NotBidder: "Only the bidder can do this.",
  SelfBid: "You cannot bid on your own NFT.",
  OnlyMarketplace: "This call must go through the marketplace contract.",
  // ── Listings / buying ───────────────────────────────────────────────────
  ListingNotFound: "This NFT is no longer listed.",
  ListingExpired: "This listing has expired.",
  NotSeller: "Only the seller can change this listing.",
  NotTokenOwner: "The seller no longer owns this NFT.",
  NotApproved: "The marketplace is not approved to transfer this NFT. Approve the collection and try again.",
  SelfPurchase: "You cannot buy your own NFT.",
  InsufficientValue: "The amount sent does not match the required price.",
  InvalidPrice: "Enter a price greater than zero.",
  InvalidExpiry: "Choose a valid expiration date.",
  ExpiryTooLarge: "The expiration date is too far in the future (max 30 days).",
  DuplicateTokenId: "The same NFT appears twice in this batch.",
  ArrayLengthMismatch: "The batch is inconsistent. Reload the page and try again.",
  BatchTooLarge: "Too many items in one transaction (max 50).",
  // ── Gas / external calls ────────────────────────────────────────────────
  InsufficientGas: "The transaction ran out of gas while checking the NFT. Retry with a higher gas limit.",
  BoundedStaticCallInsufficientGas: "The transaction ran out of gas while checking the collection. Retry with a higher gas limit.",
  // ── Pause / admin ───────────────────────────────────────────────────────
  CorePaused: "The marketplace is paused. Trading is temporarily disabled.",
  EnforcedPause: "This contract is paused. Try again later.",
  ExpectedPause: "This action is only available while the contract is paused.",
  OwnableUnauthorizedAccount: "Only the contract owner can do this.",
  OwnableInvalidOwner: "Invalid owner address.",
  RenounceOwnershipDisabled: "Renouncing ownership is disabled.",
  ComponentsNotOwned: "The marketplace components are not owned by the router yet.",
  AlreadySet: "This setting can only be set once.",
  Unauthorized: "You are not authorized to do this.",
  FeeTooHigh: "The fee exceeds the maximum allowed.",
  // ── Collections ─────────────────────────────────────────────────────────
  CollectionNotRegistered: "This collection is not registered on the marketplace.",
  CollectionAlreadyRegistered: "This collection is already registered.",
  InvalidCollection: "This address is not a valid ERC-721 collection.",
  NotCollectionOwner: "Only the collection owner can do this.",
  InvalidAddress: "An address is missing or invalid.",
  InvalidCall: "This call is not valid for the current state.",
  // ── Withdrawals / ETH ───────────────────────────────────────────────────
  NoWithdrawal: "There is nothing to withdraw.",
  TransferFailed: "The payment transfer failed.",
  SweepFailed: "The sweep transfer failed.",
  InsufficientExcess: "There is no excess balance to sweep.",
  NoFees: "There are no fees to withdraw.",
  // ── Launchpad / mint (Hyperc) ───────────────────────────────────────────
  InsufficientLaunchFee: "The launch fee sent is too low.",
  PageTooLarge: "Requested page is too large.",
  InsufficientPayment: "The mint payment is too low.",
  InvalidAmount: "Choose a valid amount to mint.",
  MaxSupplyExceeded: "Not enough supply left to mint that many.",
  MintEnded: "Minting has ended for this collection.",
  InvalidMaxSupply: "Invalid maximum supply.",
  InvalidOwner: "Invalid owner.",
  InvalidRoyaltyFee: "The royalty fee is too high.",
  ERC721EnumerableForbiddenBatchMint: "Batch minting is not supported by this collection.",
  ERC721IncorrectOwner: "This NFT is owned by someone else.",
  ERC721InsufficientApproval: "The marketplace is not approved for this NFT.",
  ERC721InvalidApprover: "Invalid approver.",
  ERC721InvalidOperator: "Invalid operator.",
  ERC721InvalidOwner: "Invalid owner.",
  ERC721InvalidReceiver: "The receiver cannot accept NFTs.",
  ERC721InvalidSender: "Invalid sender.",
  ERC721NonexistentToken: "This NFT does not exist.",
  ERC721OutOfBoundsIndex: "Index out of bounds.",
  ERC2981InvalidDefaultRoyalty: "Invalid default royalty.",
  ERC2981InvalidDefaultRoyaltyReceiver: "Invalid royalty receiver.",
  ERC2981InvalidTokenRoyalty: "Invalid token royalty.",
  ERC2981InvalidTokenRoyaltyReceiver: "Invalid token royalty receiver.",
  // ── Internal ────────────────────────────────────────────────────────────
  ReentrancyGuardReentrantCall: "The transaction was rejected by the reentrancy guard.",
  SafeCastOverflowedUintDowncast: "An amount is too large.",
}

/** Every error fragment, for decoding raw revert data a narrower ABI could not name. */
const ALL_ERRORS = [MarketplaceRouterAbi, MarketplaceCoreAbi, MarketplaceBidsAbi, LaunchPadAbi, HypercAbi].flatMap((abi) =>
  (abi as readonly { type: string }[]).filter((i) => i.type === "error"),
)

/** The custom error name inside a viem error chain, if any. */
export function contractErrorName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
  if (!(reverted instanceof ContractFunctionRevertedError)) return undefined
  if (reverted.data?.errorName) return reverted.data.errorName
  const raw = reverted.raw as Hex | undefined
  if (!raw || raw === "0x") return undefined
  try {
    return decodeErrorResult({ abi: ALL_ERRORS, data: raw }).errorName
  } catch {
    return undefined
  }
}

function isKnown(name: string): name is ContractErrorName {
  return Object.prototype.hasOwnProperty.call(CONTRACT_ERROR_MESSAGES, name)
}

/**
 * One readable sentence for any error a write flow can throw: chain guard,
 * bid-acceptance refusals, wallet rejection, decoded contract errors, and a
 * fallback that never echoes raw revert data.
 */
export function contractErrorMessage(error: unknown, fallback = "The transaction failed."): string {
  const guard = chainGuardErrorMessage(error)
  if (guard) return guard
  if (error instanceof BidAcceptanceError) return error.message

  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return "You rejected the request in your wallet."
    const name = contractErrorName(error)
    if (name) return isKnown(name) ? CONTRACT_ERROR_MESSAGES[name] : `The contract rejected the transaction (${name}).`
    if (/insufficient funds/i.test(error.details ?? error.shortMessage)) return "Your wallet balance is too low for this transaction (amount + gas)."
    return fallback
  }

  if (error instanceof Error && error.message === "Transaction reverted on-chain") return "The transaction reverted on-chain."
  return fallback
}

/** True when the user cancelled in the wallet (no message needed). */
export function isUserRejection(error: unknown): boolean {
  return error instanceof BaseError && !!error.walk((e) => e instanceof UserRejectedRequestError)
}
