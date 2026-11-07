import { createServiceClient } from "@marketplace/database"
import type { SupabaseClient } from "@supabase/supabase-js"

/** True when a local Supabase stack was provided for the localdb suite. */
export const HAS_LOCALDB = Boolean(process.env.INDEXER_TEST_SUPABASE_URL && process.env.INDEXER_TEST_SUPABASE_SERVICE_ROLE_KEY)

export function localClient(): SupabaseClient {
  const url = process.env.INDEXER_TEST_SUPABASE_URL!
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    throw new Error(`localdb suite refuses a non-local Supabase URL: ${url}`)
  }
  return createServiceClient(url, process.env.INDEXER_TEST_SUPABASE_SERVICE_ROLE_KEY!)
}

/** A 0x-prefixed 32-byte hex hash unique to this run, for test rows. */
export function testTxHash(tag: string, n: number): string {
  const hex = Buffer.from(`${tag}:${process.pid}:${n}`).toString("hex").padEnd(64, "0").slice(0, 64)
  return `0x${hex}`
}
