// Write hooks + chainGuard, with wagmi mocked: a write must be refused (and
// writeContractAsync never reached) unless the wallet is on the data chain and
// that chain has marketplace contracts.
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ELYSIUM_ADDRESSES } from "@marketplace/contracts"

const wallet = vi.hoisted(() => ({ chainId: undefined as number | undefined }))
const writeContractAsync = vi.hoisted(() => vi.fn(async () => "0xhash" as const))

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useCallback: <T,>(f: T) => f }))
vi.mock("wagmi", () => ({
  useConfig: () => ({}),
  useWriteContract: () => ({ writeContractAsync }),
  usePublicClient: () => undefined,
}))
vi.mock("wagmi/actions", () => ({ getConnection: () => ({ chainId: wallet.chainId }) }))

import { useBuy } from "./useBuyActions"
import { useAcceptTokenBid, useBidCollection, useCancelTokenBid } from "./useBidActions"
import { useCancelList } from "./useListingActions"
import { ChainGuardError, DATA_CHAIN_ID, assertWriteTarget, requireChainContracts } from "@/lib/chainGuard"
import { networkStatus } from "@/lib/networkStatus"
import type { AcceptQuote } from "@/lib/bidAcceptance"

const B = BigInt
const ELYSIUM = 99801
const SEPOLIA = 11155111
const COLLECTION = "0x00000000000000000000000000000000000000c1" as const
const BIDDER = "0x00000000000000000000000000000000000000b1" as const

const quote: AcceptQuote = {
  kind: "token",
  collection: COLLECTION,
  bidder: BIDDER,
  tokenIds: [B(7)],
  price: B(1000),
  total: B(1000),
  marketplaceFeeBps: B(250),
  marketplaceFee: B(25),
  royalty: B(50),
  royaltySources: ["collection"],
  proceeds: B(925),
}

const writes = () => [
  () => useBuy(ELYSIUM).buy(COLLECTION, B(1), B(1000)),
  () => useCancelList(ELYSIUM).cancelList(COLLECTION, 1),
  () => useCancelTokenBid(ELYSIUM).cancelTokenBid(COLLECTION, 1),
  () => useBidCollection(ELYSIUM).bidCollection(COLLECTION, B(1000), 2, 0),
  () => useAcceptTokenBid(ELYSIUM).acceptTokenBid(quote),
]

beforeEach(() => {
  writeContractAsync.mockClear()
  wallet.chainId = undefined
})

describe("data chain", () => {
  it("is Elysium and has contracts", () => {
    expect(DATA_CHAIN_ID).toBe(ELYSIUM)
    expect(requireChainContracts(DATA_CHAIN_ID)).toBe(ELYSIUM_ADDRESSES)
  })
})

describe("write gate (assertWriteTarget)", () => {
  it("rejects disconnected, wrong-chain and non-deployed targets", () => {
    expect(() => assertWriteTarget(undefined, ELYSIUM)).toThrow(ChainGuardError)
    expect(() => assertWriteTarget(SEPOLIA, ELYSIUM)).toThrow(/Wrong network/)
    expect(() => assertWriteTarget(1, 1)).toThrow(ChainGuardError) // unsupported page chain
    expect(() => requireChainContracts(1)).toThrow(/not deployed/)
  })

  it("returns the target chain's contracts when the wallet matches", () => {
    expect(assertWriteTarget(ELYSIUM, ELYSIUM)).toBe(ELYSIUM_ADDRESSES)
  })
})

describe("write hooks never reach the wallet on a chain mismatch", () => {
  for (const [label, chainId] of [
    ["disconnected", undefined],
    ["Sepolia wallet", SEPOLIA],
    ["unsupported chain", 1],
  ] as const) {
    it(`${label}: every write is refused with a ChainGuardError`, async () => {
      wallet.chainId = chainId
      for (const write of writes()) {
        await expect(write()).rejects.toBeInstanceOf(ChainGuardError)
      }
      expect(writeContractAsync).not.toHaveBeenCalled()
    })
  }

  it("wallet on the data chain: writes go to that chain's router with chainId pinned", async () => {
    wallet.chainId = ELYSIUM
    for (const write of writes()) await write()
    expect(writeContractAsync).toHaveBeenCalledTimes(writes().length)
    for (const [call] of writeContractAsync.mock.calls as unknown as [{ address: string; chainId: number }][]) {
      expect(call.address).toBe(ELYSIUM_ADDRESSES.MARKETPLACE)
      expect(call.chainId).toBe(ELYSIUM)
    }
  })

  it("acceptTokenBid passes exactly the quoted bounds (0 slippage)", async () => {
    wallet.chainId = ELYSIUM
    await useAcceptTokenBid(ELYSIUM).acceptTokenBid(quote)
    const [call] = writeContractAsync.mock.calls[0] as unknown as [{ functionName: string; args: unknown[] }]
    expect(call.functionName).toBe("acceptTokenBid")
    expect(call.args).toEqual([COLLECTION, B(7), BIDDER, B(1000), B(925)])
  })
})

describe("networkStatus (switch-network banner)", () => {
  const hasContracts = (id: number) => id === ELYSIUM || id === SEPOLIA
  it("is ok when disconnected or on the data chain", () => {
    expect(networkStatus({ isConnected: false, walletChainId: 1, dataChainId: ELYSIUM, hasContracts })).toEqual({ kind: "ok" })
    expect(networkStatus({ isConnected: true, walletChainId: ELYSIUM, dataChainId: ELYSIUM, hasContracts })).toEqual({ kind: "ok" })
  })
  it("flags unsupported chains and other supported chains", () => {
    expect(networkStatus({ isConnected: true, walletChainId: 1, dataChainId: ELYSIUM, hasContracts })).toEqual({ kind: "unsupported", walletChainId: 1 })
    expect(networkStatus({ isConnected: true, walletChainId: SEPOLIA, dataChainId: ELYSIUM, hasContracts })).toEqual({ kind: "wrong-chain", walletChainId: SEPOLIA })
  })
})
