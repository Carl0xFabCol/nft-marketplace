import { describe, expect, it } from "vitest"
import { BlockRangeUtil } from "./BlockRange"

describe("BlockRangeUtil", () => {
  it("chunks a range into equal-sized pieces", () => {
    const chunks = BlockRangeUtil.chunk(0n, 9n, 5)
    expect(chunks).toEqual([
      { from: 0n, to: 4n },
      { from: 5n, to: 9n },
    ])
  })

  it("handles a single-block range", () => {
    const chunks = BlockRangeUtil.chunk(100n, 100n, 5000)
    expect(chunks).toEqual([{ from: 100n, to: 100n }])
  })

  it("handles exact multiple of chunkSize", () => {
    const chunks = BlockRangeUtil.chunk(0n, 9999n, 10000)
    expect(chunks).toEqual([{ from: 0n, to: 9999n }])
  })

  it("size returns inclusive block count", () => {
    expect(BlockRangeUtil.size({ from: 0n, to: 9n })).toBe(10n)
    expect(BlockRangeUtil.size({ from: 100n, to: 100n })).toBe(1n)
  })

  it("isValid rejects inverted ranges", () => {
    expect(BlockRangeUtil.isValid({ from: 5n, to: 10n })).toBe(true)
    expect(BlockRangeUtil.isValid({ from: 10n, to: 5n })).toBe(false)
  })

  it("requiresArchive returns true when range is older than threshold", () => {
    expect(BlockRangeUtil.requiresArchive({ from: 0n, to: 100n }, 500n, 128n)).toBe(true)
    expect(BlockRangeUtil.requiresArchive({ from: 400n, to: 450n }, 500n, 128n)).toBe(false)
    expect(BlockRangeUtil.requiresArchive({ from: 0n, to: 400n }, 500n, 128n)).toBe(false)
  })
})
