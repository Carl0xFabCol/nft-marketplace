import { describe, expect, it } from "vitest"
import { compareWei, formatEtherText, formatWei, parseEtherInput, sumWei, toWei, truncateDecimal } from "./wei"

const B = BigInt

describe("wei helpers (no JS number on the path)", () => {
  it("toWei accepts only bigint or decimal-integer text", () => {
    expect(toWei("1234567890123456789")).toBe(B("1234567890123456789"))
    expect(toWei(B(5))).toBe(B(5))
    for (const bad of ["1e+21", "1.5", "-1", "", "0x10", " 1", null, undefined]) expect(toWei(bad as string)).toBeNull()
  })

  it("formatWei is exact where Number() is not", () => {
    // Number("1234567890123456789") === 1234567890123456800
    expect(formatWei("1234567890123456789", 18)).toBe("1.234567890123456789")
    expect(formatWei("1234567890123456789")).toBe("1.2345") // truncated, not rounded up
    expect(formatWei("999999999999999999", 4)).toBe("0.9999")
    expect(formatWei("1000000000000000000")).toBe("1")
    expect(formatWei("0")).toBe("0")
    expect(formatWei(B(10) ** B(30))).toBe("1000000000000")
    expect(formatWei(null)).toBe("-")
    expect(formatWei("abc", 4, "0")).toBe("0")
  })

  it("truncateDecimal and formatEtherText", () => {
    expect(truncateDecimal("0.21500", 3)).toBe("0.215")
    expect(truncateDecimal("12.0001", 3)).toBe("12")
    expect(truncateDecimal("-0.0001", 2)).toBe("0")
    expect(formatEtherText("0.215")).toBe("0.215")
    expect(formatEtherText("1.234567890123456789", 6)).toBe("1.234567")
    expect(formatEtherText(null)).toBe("-")
  })

  it("parseEtherInput is exact (no Math.floor(Number * 1e18))", () => {
    expect(parseEtherInput("0.1")).toBe(B("100000000000000000"))
    expect(parseEtherInput("1.000000000000000001")).toBe(B("1000000000000000001"))
    // Number-based conversion gives 0.30000000000000004 * 1e18 style errors:
    expect(parseEtherInput("0.3")).toBe(B("300000000000000000"))
    for (const bad of ["", ".", "1e3", "-1", "abc"]) expect(parseEtherInput(bad)).toBeUndefined()
  })

  it("compareWei and sumWei work beyond 2^53", () => {
    const a = "9007199254740993" // 2^53 + 1
    const b = "9007199254740992"
    expect(compareWei(a, b)).toBe(1)
    expect([a, null, b].sort(compareWei)).toEqual([b, a, null])
    expect(sumWei([a, b, null, "x"])).toBe(B("18014398509481985"))
  })
})
