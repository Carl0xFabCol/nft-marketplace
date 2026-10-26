/**
 * Shared input hardening helpers.
 *
 * Supabase queries are parameterised, so these helpers are not about escaping
 * SQL. They prevent PostgREST filter-grammar injection (`.or(...)` strings),
 * control characters and oversized values from reaching the database or UI.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u000D\u000E-\u001F\u007F]/g

export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, "")
}

/**
 * Prepares a free-text term for use inside a PostgREST `.or()` filter.
 *
 * Characters that change the filter grammar (`,` `(` `)` `\`) or the LIKE
 * pattern (`%` `_` `*`) are removed. The caller adds its own `%` wildcards.
 */
export function sanitizePostgrestSearch(value: string, maxLength = 64): string {
  return stripControlChars(value)
    .trim()
    .slice(0, maxLength)
    .replace(/[%,()\\*"']/g, "")
}

/** Normalises user-supplied pagination values into a safe integer range. */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

export function isSafeImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "ipfs:"
  } catch {
    return false
  }
}
