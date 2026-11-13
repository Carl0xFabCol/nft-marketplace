import { describe, expect, it } from "vitest"
import { anvilReorgParams } from "../reorg"

const FROM = "0x976EA74026E726554dB657fA54763abd0C3a0aa9" as const

describe("anvilReorgParams", () => {
  it("carries a transaction, so the replacement blocks cannot be byte-identical to the originals", () => {
    const [, txs] = anvilReorgParams(270n, 268n, FROM)
    expect(txs).toHaveLength(1)
    expect(txs[0][1]).toBe(0) // in the first replacement block, so every later hash changes too
    expect(txs[0][0]).toEqual({ from: FROM, to: FROM, value: "0x1" })
  })

  it("reaches below the stored cursor block (the run that failed: head 270, cursor 268)", () => {
    const [depth] = anvilReorgParams(270n, 268n, FROM)
    // replaced range is (head - depth, head]; the cursor block must be inside it
    expect(270 - depth).toBeLessThan(268)
  })

  it("covers a cursor at the head", () => {
    const [depth] = anvilReorgParams(100n, 100n, FROM)
    expect(100 - depth).toBeLessThan(100)
  })

  it("refuses a cursor above the head", () => {
    expect(() => anvilReorgParams(10n, 11n, FROM)).toThrow(/above head/)
  })
})
