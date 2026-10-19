import { describe, expect, it, vi } from "vitest"
import { isRateLimitError, isRetryableError, withRetry } from "./retry"

describe("withRetry", () => {
  it("returns the result on the first successful attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok")
    const result = await withRetry(fn)
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries until success within maxAttempts", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue("ok")
    const result = await withRetry(fn, { maxAttempts: 3, initialBackoffMs: 0 })
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("throws the last error after exhausting all attempts", async () => {
    const error = new Error("boom")
    const fn = vi.fn().mockRejectedValue(error)
    await expect(withRetry(fn, { maxAttempts: 2, initialBackoffMs: 0 })).rejects.toBe(error)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe("isRetryableError", () => {
  it("detects timeout/network errors", () => {
    expect(isRetryableError(new Error("connection timeout"))).toBe(true)
    expect(isRetryableError(new Error("network error"))).toBe(true)
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true)
    expect(isRetryableError(new Error("ENOTFOUND"))).toBe(true)
    expect(isRetryableError(new Error("rate limit"))).toBe(true)
  })

  it("returns false for non-retryable errors", () => {
    expect(isRetryableError(new Error("something else"))).toBe(false)
    expect(isRetryableError("not an error")).toBe(false)
  })
})

describe("isRateLimitError", () => {
  it("detects HTTP 429 and RPC -32017", () => {
    expect(isRateLimitError(new Error("429"))).toBe(true)
    expect(isRateLimitError(new Error("-32017"))).toBe(true)
    expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true)
  })

  it("returns false for unrelated errors", () => {
    expect(isRateLimitError(new Error("timeout"))).toBe(false)
    expect(isRateLimitError("not an error")).toBe(false)
  })
})
