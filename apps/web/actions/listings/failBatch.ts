// actions/listings/failBatch.ts
"use server"

import { getServerSupabase } from "@/lib/supabase/server"
import { requireWalletMatch } from "@/lib/supabase/auth"
import { revalidatePath } from "next/cache"

// Marks every listing for `txHash` as failed + inactive. Called from the list
// flow when the tx reverts, so the optimistic `pending` rows written by
// saveBatchListingToDB don't linger forever (mirrors
// ListingsRepository.failByTxHash in packages/database).
//
// The caller must own the affected rows: we resolve the seller from the
// listings matching the hash and require the caller's profile wallet to match
// (same check as saveBatchListingToDB). Without this, any logged-in user could
// null out another seller's pending rows.
export async function failListingsByTxHash(txHash: string) {
  try {
    const hash = txHash.toLowerCase()
    const supabase = await getServerSupabase()

    const { data: rows } = await supabase.from("listings").select("seller_wallet").eq("tx_hash", hash)
    const seller = rows?.[0]?.seller_wallet
    if (!seller) return { success: true } // nothing to fail

    // Verify the caller owns the rows before mutating them.
    await requireWalletMatch(seller)

    if (seller) revalidatePath(`/user/${seller}`)

    // Build the update as a variable: `status`/`source` are not yet in the
    // generated supabase types, and an inline literal would trip the excess
    // property check.
    const updates = { is_active: false, status: "failed" }
    const { error } = await supabase.from("listings").update(updates).eq("tx_hash", hash)

    if (error) throw new Error(`Database error: ${error.message}`)

    return { success: true }
  } catch (err: any) {
    throw new Error(err.message || "Internal Server Error")
  }
}
