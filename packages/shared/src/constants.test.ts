import { describe, expect, it } from "vitest"
import { CHAIN_IDS, DEFAULT_CHAIN_ID, SUPPORTED_CHAIN_IDS, ZERO_ADDRESS } from "./constants"

describe("shared constants", () => {
  it("CHAIN_IDS exposes SEPOLIA, ELYSIUM and MAINNET", () => {
    expect(CHAIN_IDS.SEPOLIA).toBe(11155111)
    expect(CHAIN_IDS.ELYSIUM).toBe(99801)
    expect(CHAIN_IDS.MAINNET).toBe(1)
  })

  it("DEFAULT_CHAIN_ID is Elysium", () => {
    expect(DEFAULT_CHAIN_ID).toBe(CHAIN_IDS.ELYSIUM)
  })

  it("SUPPORTED_CHAIN_IDS includes Sepolia and Elysium", () => {
    expect(SUPPORTED_CHAIN_IDS).toContain(CHAIN_IDS.SEPOLIA)
    expect(SUPPORTED_CHAIN_IDS).toContain(CHAIN_IDS.ELYSIUM)
  })

  it("ZERO_ADDRESS is the null address", () => {
    expect(ZERO_ADDRESS).toBe("0x0000000000000000000000000000000000000000")
  })
})
