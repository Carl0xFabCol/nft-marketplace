/**
 * Small in-process rate limiter for unauthenticated API routes.
 *
 * This is intentionally best-effort: serverless instances each keep their own
 * bucket, so it complements (not replaces) platform-level rate limiting. It
 * stops trivial loops from spamming nonce creation / login attempts.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000
let lastSweep = 0

function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  sweep(now)

  if (buckets.size >= MAX_BUCKETS) {
    return false
  }

  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (bucket.count >= limit) {
    return false
  }

  bucket.count += 1
  return true
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown"
  return request.headers.get("x-real-ip") || "unknown"
}
