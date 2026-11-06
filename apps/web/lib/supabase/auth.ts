// lib/supabase/auth.ts
//
// Shared auth guards for optimistic server actions. These run on the server
// (via getServerSupabase) and protect DB writes the browser triggers directly,
// e.g. saveBatchListingToDB. Contract-tx → indexer writes don't need them —
// the indexer uses the service role.

import { createSupabaseAdmin } from "./admin"
import { getServerSupabase } from "./server"

type ServerSupabase = Awaited<ReturnType<typeof getServerSupabase>>

async function resolveAuthenticatedWallet(supabase: ServerSupabase): Promise<string> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new Error("Unauthorized")
  }

  const admin = createSupabaseAdmin()
  const { data: mapping, error: mappingError } = await admin
    .from("user_wallets")
    .select("wallet_address")
    .eq("supabase_user_id", user.id)
    .maybeSingle()

  if (mappingError) {
    console.error("Wallet ownership lookup failed:", mappingError)
    throw new Error("Forbidden: Wallet mismatch")
  }

  if (!mapping?.wallet_address) {
    throw new Error("Forbidden: Wallet mismatch")
  }

  return mapping.wallet_address.toLowerCase()
}

/**
 * Resolves the authenticated user and asserts that the wallet linked to their
 * server-side `user_wallets` mapping matches `expectedWallet` (case-insensitive).
 *
 * `profiles.wallet` is intentionally not used as proof of ownership: it is a
 * display field written by the login flow, while `user_wallets` is the
 * service-role-only wallet ↔ auth-user mapping. Throws `Unauthorized` when
 * there is no session and `Forbidden: Wallet mismatch` when the caller tries to
 * act on a wallet that isn't theirs.
 *
 * Returns the user-scoped supabase client so callers can reuse it for
 * follow-up reads instead of calling getServerSupabase() again.
 */
export async function requireWalletMatch(expectedWallet: string) {
  const supabase = await getServerSupabase()
  const wallet = await resolveAuthenticatedWallet(supabase)

  if (wallet !== expectedWallet.toLowerCase()) {
    throw new Error("Forbidden: Wallet mismatch")
  }

  return supabase
}

/**
 * Resolves the caller's canonical wallet from the service-role-only mapping.
 * Use this when an action needs to scope a write by the authenticated wallet
 * without trusting a wallet supplied by the client.
 */
export async function getAuthenticatedWallet(): Promise<string> {
  const supabase = await getServerSupabase()
  return resolveAuthenticatedWallet(supabase)
}
