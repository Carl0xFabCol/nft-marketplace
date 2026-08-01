// lib/supabase/auth.ts
//
// Shared auth guards for optimistic server actions. These run on the server
// (via getServerSupabase) and protect DB writes the browser triggers directly,
// e.g. saveBatchListingToDB. Contract-tx → indexer writes don't need them —
// the indexer uses the service role.

import { getServerSupabase } from "./server"

/**
 * Resolves the authenticated user and asserts that the wallet linked to their
 * profile matches `expectedWallet` (case-insensitive). Throws `Unauthorized`
 * when there is no session and `Forbidden: Wallet mismatch` when the caller
 * tries to act on a wallet that isn't theirs.
 *
 * Returns the supabase client so callers can reuse it for the follow-up
 * query/update instead of calling getServerSupabase() again.
 */
export async function requireWalletMatch(expectedWallet: string) {
  const supabase = await getServerSupabase()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new Error("Unauthorized")
  }

  const { data: profile } = await supabase.from("profiles").select("wallet").eq("id", user.id).single()

  if (!profile || profile.wallet?.toLowerCase() !== expectedWallet.toLowerCase()) {
    throw new Error("Forbidden: Wallet mismatch")
  }

  return supabase
}
