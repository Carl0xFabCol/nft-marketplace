// actions/listings/failBatch.ts
"use server"

import { createSupabaseAdmin } from "@/lib/supabase/admin"
import { getAuthenticatedWallet } from "@/lib/supabase/auth"
import { revalidatePath } from "next/cache"
import { SUPPORTED_CHAIN_IDS } from "@/lib/chains"

const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/

// Marks every listing for `txHash` as failed + inactive. Called from the list
// flow when the tx reverts, so the optimistic `pending` rows written by
// saveBatchListingToDB don't linger forever (mirrors
// ListingsRepository.failByTxHash in packages/database).
//
// The caller must own the affected rows. Resolve the wallet from the trusted
// user_wallets mapping and scope the update to that wallet's rows; never trust
// a seller taken from arbitrary rows sharing the hash.
export async function failListingsByTxHash(txHash: string, chainId: number) {
  try {
    if (typeof txHash !== "string" || !HASH_PATTERN.test(txHash)) {
      throw new Error("Invalid transaction hash")
    }
    if (!Number.isInteger(chainId) || !SUPPORTED_CHAIN_IDS.includes(chainId)) {
      throw new Error("Unsupported chain")
    }

    const hash = txHash.toLowerCase()
    const admin = createSupabaseAdmin()

    const { data: rows } = await admin.from("listings").select("seller_wallet").eq("tx_hash", hash).eq("chain_id", chainId)
    if (!rows?.length) return { success: true } // nothing to fail

    // Never derive the caller from the rows: another wallet may have inserted
    // a row with the same tx hash. Scope the update to the authenticated
    // wallet's own rows.
    const callerWallet = await getAuthenticatedWallet()
    const ownsRows = rows.some((row) => row.seller_wallet?.toLowerCase() === callerWallet)
    if (!ownsRows) return { success: true }

    revalidatePath(`/user/${callerWallet}`)

    // Build the update as a variable: `status`/`source` are not yet in the
    // generated supabase types, and an inline literal would trip the excess
    // property check.
    const updates = { is_active: false, status: "failed" }
    const { error } = await admin
      .from("listings")
      .update(updates)
      .eq("tx_hash", hash)
      .eq("chain_id", chainId)
      .eq("seller_wallet", callerWallet)

    if (error) {
      console.error("Failed to mark listings as failed:", error)
      throw new Error("Failed to update listings")
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    if (message === "Unauthorized" || message.startsWith("Forbidden") || message.startsWith("Invalid") || message.startsWith("Unsupported")) {
      throw err
    }

    console.error("failListingsByTxHash error:", err)
    throw new Error("Failed to update listings")
  }
}
