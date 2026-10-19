import { describe, expect, it, vi } from "vitest"
import {
  CONTRACT_ADDRESSES,
  DEFAULT_ADDRESSES_CHAIN_ID,
  ELYSIUM_ADDRESSES,
  SEPOLIA_ADDRESSES,
  getContractAddresses,
} from "./addresses"

describe("contracts addresses", () => {
  it("SEPOLIA_ADDRESSES matches deployed Sepolia contracts", () => {
    expect(SEPOLIA_ADDRESSES.MARKETPLACE).toBe("0x880176caEd2C38F889e5E0AD6Ae55A871dd0f3B5")
    expect(SEPOLIA_ADDRESSES.MARKETPLACE_CORE).toBe("0x80D414fAD89E471E46c97B66F2B567e1b970A5C0")
    expect(SEPOLIA_ADDRESSES.MARKETPLACE_BIDS).toBe("0x66759517050c84A1AC239C4D37FfB7A2de05F37f")
  })

  it("ELYSIUM_ADDRESSES matches deployed Elysium contracts", () => {
    expect(typeof ELYSIUM_ADDRESSES.MARKETPLACE).toBe("string")
    expect(typeof ELYSIUM_ADDRESSES.MARKETPLACE_CORE).toBe("string")
    expect(typeof ELYSIUM_ADDRESSES.MARKETPLACE_BIDS).toBe("string")
  })

  it("CONTRACT_ADDRESSES is keyed by chain id", () => {
    expect(CONTRACT_ADDRESSES[11155111]).toBe(SEPOLIA_ADDRESSES)
    expect(CONTRACT_ADDRESSES[99801]).toBe(ELYSIUM_ADDRESSES)
  })

  it("DEFAULT_ADDRESSES_CHAIN_ID defaults to Elysium", () => {
    expect(DEFAULT_ADDRESSES_CHAIN_ID).toBe(99801)
  })

  it("getContractAddresses resolves Sepolia by chain id", () => {
    const addrs = getContractAddresses(11155111)
    expect(addrs).toBe(SEPOLIA_ADDRESSES)
  })

  it("getContractAddresses resolves Elysium by chain id", () => {
    const addrs = getContractAddresses(99801)
    expect(addrs).toBe(ELYSIUM_ADDRESSES)
  })

  it("getContractAddresses falls back to default chain with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const addrs = getContractAddresses(999999)
    expect(addrs).toBe(CONTRACT_ADDRESSES[DEFAULT_ADDRESSES_CHAIN_ID])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
