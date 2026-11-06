import { describe, expect, it } from "vitest"
import { DEFAULT_CHAIN_ID } from "@marketplace/shared"
import { SUPPORTED_CHAINS } from "@/lib/chains"
import { assertWalletChain, ChainGuardError, isSupportedChainId, requireSupportedChainId } from "./chainGuard"

const SEPOLIA = 11155111
const ELYSIUM = 99801

describe("chainGuard", () => {
  it("keeps an Elysium page pinned to Elysium when the wallet is disconnected", () => {
    // wagmi's first configured chain is Sepolia; the page must not inherit it.
    expect(SUPPORTED_CHAINS[0].id).toBe(SEPOLIA)
    expect(requireSupportedChainId(DEFAULT_CHAIN_ID)).toBe(ELYSIUM)
    expect(() => assertWalletChain(undefined, DEFAULT_CHAIN_ID)).toThrow(ChainGuardError)
  })

  it("rejects a write when the connected wallet is on another chain", () => {
    expect(() => assertWalletChain(SEPOLIA, ELYSIUM)).toThrow(/Wrong network/)
    expect(() => assertWalletChain(ELYSIUM, SEPOLIA)).toThrow(/Wrong network/)
  })

  it("allows a write when the wallet and page chains match", () => {
    expect(assertWalletChain(ELYSIUM, ELYSIUM)).toBe(ELYSIUM)
  })

  it("fails closed for missing or unsupported page chains", () => {
    expect(isSupportedChainId(undefined)).toBe(false)
    expect(isSupportedChainId(1)).toBe(false)
    expect(() => requireSupportedChainId(undefined)).toThrow("unsupported chain")
    expect(() => requireSupportedChainId(1)).toThrow("unsupported chain")
    expect(() => assertWalletChain(ELYSIUM, 1)).toThrow("unsupported chain")
  })
})
