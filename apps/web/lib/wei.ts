// lib/wei.ts
//
// Exact wei handling for the UI. Wei amounts reach the web as decimal-integer
// TEXT (PostgREST `price::text` casts, see lib/supabase/columns.ts) or bigint
// (contract reads) and are never turned into JS numbers: Number() silently
// rounds anything above 2^53 (~0.009 ETH in wei). Display rounding happens on
// the decimal string, never in floating point.

import { formatEther, parseEther } from "viem"

export type WeiLike = string | bigint | null | undefined

const UINT_TEXT = /^\d{1,78}$/

/** Exact bigint for a wei value given as bigint or decimal-integer text; null otherwise. */
export function toWei(value: WeiLike): bigint | null {
  if (typeof value === "bigint") return value
  if (typeof value === "string" && UINT_TEXT.test(value)) return BigInt(value)
  return null
}

/** Truncate (round toward zero) a plain decimal string to `maxDecimals`, dropping trailing zeros. */
export function truncateDecimal(text: string, maxDecimals: number): string {
  const negative = text.startsWith("-")
  const body = negative ? text.slice(1) : text
  const [int, frac = ""] = body.split(".")
  const cut = frac.slice(0, Math.max(0, maxDecimals)).replace(/0+$/, "")
  const out = cut ? `${int}.${cut}` : int
  return negative && /[1-9]/.test(out) ? `-${out}` : out
}

/** Wei → ether string, truncated to `maxDecimals` (default 4). `fallback` for missing/invalid input. */
export function formatWei(value: WeiLike, maxDecimals = 4, fallback = "-"): string {
  const wei = toWei(value)
  if (wei === null) return fallback
  return truncateDecimal(formatEther(wei), maxDecimals)
}

/**
 * An ether-denominated decimal TEXT (e.g. collections.total_volume, which the
 * indexer accumulates as `wei * 1e-18`), truncated for display.
 */
export function formatEtherText(value: string | null | undefined, maxDecimals = 3, fallback = "-"): string {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) return fallback
  return truncateDecimal(value, maxDecimals)
}

/** User-typed ether amount → wei, exactly (viem parseEther). undefined when empty or invalid. */
export function parseEtherInput(value: string): bigint | undefined {
  const v = value.trim()
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return undefined
  try {
    return parseEther(v)
  } catch {
    return undefined
  }
}

/** bigint comparator for sorting wei text/bigint (missing values last). */
export function compareWei(a: WeiLike, b: WeiLike): number {
  const x = toWei(a)
  const y = toWei(b)
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  return x < y ? -1 : x > y ? 1 : 0
}

/** Exact sum of wei values (invalid entries count as 0). */
export function sumWei(values: WeiLike[]): bigint {
  return values.reduce<bigint>((acc, v) => acc + (toWei(v) ?? BigInt(0)), BigInt(0))
}

/** part / total as a percentage string with 2 decimals (bigint, truncated). "0" when total is 0. */
export function percentOf(part: bigint, total: bigint): string {
  if (total <= BigInt(0)) return "0"
  const bp = (part * BigInt(10_000)) / total // hundredths of a percent
  const s = bp.toString().padStart(3, "0")
  return truncateDecimal(`${s.slice(0, -2)}.${s.slice(-2)}`, 2)
}
