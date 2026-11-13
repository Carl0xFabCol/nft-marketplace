// Step 6: on-chain scenarios through the router, with the same generated ABI
// bundle the web uses (@marketplace/contracts/abis/web). Every unexpected
// revert stops the run with the decoded error (web mapper) and full context.

import { erc721Abi, parseAbi, parseEther, type Abi, type Address } from "viem"
import { contractErrorMessage, contractErrorName } from "@/lib/contractErrors"
import { account, HypercAbi, MarketplaceRouterAbi, send, type Role } from "./chain"
import type { Ctx } from "./ctx"

export const MockNftAbi = parseAbi(["function mint(address to, uint256 tokenId)"])
const DAY = 86_400n

export class UnexpectedRevert extends Error {
  constructor(
    readonly what: string,
    readonly decoded: string | undefined,
    readonly readable: string,
    cause: unknown,
  ) {
    super(`UNEXPECTED REVERT in "${what}": ${decoded ?? "(undecoded)"} — ${readable}\n${cause instanceof Error ? cause.message.split("\n").slice(0, 6).join("\n") : String(cause)}`)
    this.name = "UnexpectedRevert"
  }
}

export interface TxSpec {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}

/** Sends a tx that MUST succeed. */
export async function must(c: Ctx, what: string, role: Role, spec: TxSpec) {
  try {
    const r = await send(c.chain, role, spec)
    c.log.info(`tx ok: ${what}`, { block: r.blockNumber, tx: r.transactionHash })
    return r
  } catch (e) {
    throw new UnexpectedRevert(what, contractErrorName(e), contractErrorMessage(e), e)
  }
}

/** Sends a tx that MUST revert with `errorName`; returns the web's readable message. */
export async function mustRevert(c: Ctx, what: string, role: Role, spec: TxSpec, errorName: string): Promise<string> {
  try {
    await send(c.chain, role, spec)
  } catch (e) {
    const name = contractErrorName(e)
    c.log.eq(`${what}: reverts with ${errorName}`, name, errorName)
    return contractErrorMessage(e)
  }
  c.log.check(`${what}: reverts with ${errorName}`, false, "the transaction succeeded")
  return ""
}

export const router = (c: Ctx, functionName: string, args: readonly unknown[] = [], value?: bigint): TxSpec => ({
  address: c.addresses.router,
  abi: MarketplaceRouterAbi as unknown as Abi,
  functionName,
  args,
  value,
})

export async function now(c: Ctx): Promise<bigint> {
  return (await c.chain.pub.getBlock()).timestamp
}

/** Mints on Hyperc collections (A, C): returns the new token ids. */
async function mintHyperc(c: Ctx, collection: Address, to: Role, n: number): Promise<bigint[]> {
  const ids: bigint[] = []
  for (let i = 0; i < n; i++) {
    const next = (await c.chain.pub.readContract({ address: collection, abi: HypercAbi, functionName: "getNextTokenId" })) as bigint
    await must(c, `mint ${collection}#${next}`, to, { address: collection, abi: HypercAbi as unknown as Abi, functionName: "mint", args: [account(to).address], value: 0n })
    ids.push(next)
  }
  return ids
}

async function mintMock(c: Ctx, collection: Address, to: Role, ids: bigint[]): Promise<bigint[]> {
  for (const id of ids) await must(c, `mint ${collection}#${id}`, to, { address: collection, abi: MockNftAbi, functionName: "mint", args: [account(to).address, id] })
  return ids
}

async function approveCore(c: Ctx, role: Role, collections: Address[]) {
  for (const col of collections) {
    await must(c, `${role} setApprovalForAll(core) on ${col}`, role, { address: col, abi: erc721Abi, functionName: "setApprovalForAll", args: [c.addresses.core, true] })
  }
}

/** Tokens each scenario uses; minted once. */
export interface Inventory {
  A: { alice: bigint[]; dave: bigint[] }
  B: { alice: bigint[]; dave: bigint[] }
  C: { alice: bigint[]; dave: bigint[] }
  D: { alice: bigint[]; dave: bigint[] }
}

export async function mintInventory(c: Ctx): Promise<Inventory> {
  const { A, B, C, D } = c.collections
  const inv: Inventory = {
    A: { alice: await mintHyperc(c, A, "alice", 10), dave: await mintHyperc(c, A, "dave", 4) },
    B: { alice: await mintMock(c, B, "alice", [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]), dave: await mintMock(c, B, "dave", [9n, 10n, 11n]) },
    C: { alice: await mintHyperc(c, C, "alice", 6), dave: await mintHyperc(c, C, "dave", 2) },
    D: { alice: await mintMock(c, D, "alice", [1n, 2n, 3n, 4n]), dave: await mintMock(c, D, "dave", [5n, 6n]) },
  }
  await approveCore(c, "alice", [A, B, C, D])
  await approveCore(c, "dave", [A, B, C, D])
  return inv
}

/**
 * Listing, buying, bidding, cancelling, admin flows. Bid ACCEPTANCES are in
 * slippage.ts (they go through the web quote), except where noted.
 */
export async function marketScenarios(c: Ctx, inv: Inventory): Promise<void> {
  const { A, B, C, D } = c.collections
  const t = await now(c)
  const exp = t + 7n * DAY

  // ── listings ────────────────────────────────────────────────────────────
  const [a1, a2] = inv.A.alice
  await must(c, "list A#1 1 ETH", "alice", router(c, "createListing", [A, a1, parseEther("1"), exp]))
  await must(c, "batch list A#2, B#1, C#1, B#2, B#3", "alice", router(c, "createListingBatch", [[A, B, C, B, B], [a2, 1n, inv.C.alice[0], 2n, 3n], [parseEther("2"), 1_234_567_890_123_456_789n, 7n, parseEther("0.5"), parseEther("0.25")], [exp, exp, exp, exp, exp]]))
  await must(c, "update price A#1 → 1.5 ETH", "alice", router(c, "updateListingPrice", [A, a1, parseEther("1.5")]))
  await must(c, "cancel A#2", "alice", router(c, "cancelListing", [A, a2]))
  await must(c, "bob buys A#1", "bob", router(c, "buy", [A, a1], parseEther("1.5")))
  await must(c, "bob buyBatch B#2, B#3", "bob", router(c, "buyBatch", [B, [2n, 3n]], parseEther("0.75")))
  // A relist after a sale by the new owner (M-7: buyer cleared on relist).
  await must(c, "bob approves core on A", "bob", { address: A, abi: erc721Abi, functionName: "setApprovalForAll", args: [c.addresses.core, true] })
  await must(c, "bob relists A#1 at 3 ETH", "bob", router(c, "createListing", [A, a1, parseEther("3"), exp]))

  // ── bids placed / cancelled ────────────────────────────────────────────
  const [a3, a4, a5] = inv.A.alice.slice(2, 5)
  await must(c, "carol token bid A#3 0.5 ETH (no expiry)", "carol", router(c, "placeTokenBid", [A, a3, parseEther("0.5"), 0n], parseEther("0.5")))
  await must(c, "bob token bid batch A#4, A#5", "bob", router(c, "placeTokenBidBatch", [A, [a4, a5], [parseEther("0.2"), parseEther("0.3")], [exp, exp]], parseEther("0.5")))
  await must(c, "bob cancels token bid A#5", "bob", router(c, "cancelTokenBid", [A, a5]))
  await must(c, "carol collection bid on B, 0.3 ETH × 3", "carol", router(c, "placeCollectionBid", [B, parseEther("0.3"), 3, exp], parseEther("0.9")))
  await must(c, "carol collection bid on D, 1 wei × 2", "carol", router(c, "placeCollectionBid", [D, 1n, 2, 0n], 2n))
  await must(c, "carol cancels collection bid on D", "carol", router(c, "cancelCollectionBid", [D]))
  // Replacing a token bid (a second placement on the same slot refunds the first).
  await must(c, "bob token bid A#4 raised to 0.25 ETH", "bob", router(c, "placeTokenBid", [A, a4, parseEther("0.25"), exp], parseEther("0.25")))

  // ── admin / collection flags ───────────────────────────────────────────
  await must(c, "verify A", "deployer", router(c, "verifyCollection", [A]))
  await must(c, "unverify A", "deployer", router(c, "unverifyCollection", [A]))
  await must(c, "verify A again", "deployer", router(c, "verifyCollection", [A]))
  await must(c, "verify C", "deployer", router(c, "verifyCollection", [C]))
  await must(c, "creator sets a royalty override on A (400 bps)", "creator", router(c, "updateCollectionRoyalty", [A, account("royalty").address, 400]))
  await must(c, "owner clears the override on A", "deployer", router(c, "clearRoyaltyOverride", [A]))
  await must(c, "marketplace fee 250 → 300", "deployer", router(c, "updateMarketplaceFee", [300]))
  await must(c, "marketplace fee 300 → 250", "deployer", router(c, "updateMarketplaceFee", [250]))

  // ── pause ──────────────────────────────────────────────────────────────
  await must(c, "pause", "deployer", router(c, "pause"))
  const msg = await mustRevert(c, "listing while paused", "alice", router(c, "createListing", [A, inv.A.alice[5], parseEther("1"), exp]), "EnforcedPause")
  c.log.check("the web maps EnforcedPause to a readable message", msg.length > 0 && !/0x[0-9a-f]{8}/i.test(msg), msg)
  await must(c, "unpause", "deployer", router(c, "unpause"))
}

/** Withdrawals from both components through the router (pull payments). */
export async function withdrawals(c: Ctx, roles: Role[]): Promise<void> {
  for (const role of roles) {
    const [core, bids] = (await c.chain.pub.readContract({ address: c.addresses.router, abi: MarketplaceRouterAbi, functionName: "pendingWithdrawals", args: [account(role).address] })) as readonly [bigint, bigint]
    if (core + bids === 0n) continue
    const before = await c.chain.pub.getBalance({ address: account(role).address })
    const r = await must(c, `${role} withdraws ${core} (core) + ${bids} (bids)`, role, router(c, "withdraw"))
    const after = await c.chain.pub.getBalance({ address: account(role).address })
    const gas = r.gasUsed * r.effectiveGasPrice
    c.log.eq(`${role}: balance delta == pending (core + bids) - gas`, after - before, core + bids - gas)
    const [core2, bids2] = (await c.chain.pub.readContract({ address: c.addresses.router, abi: MarketplaceRouterAbi, functionName: "pendingWithdrawals", args: [account(role).address] })) as readonly [bigint, bigint]
    c.log.eq(`${role}: nothing left pending`, core2 + bids2, 0n)
  }
}
