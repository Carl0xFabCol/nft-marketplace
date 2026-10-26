"use server"

import { revalidatePath } from "next/cache"
import { isAddress } from "viem"
import { z } from "zod"
import { requireWalletMatch } from "@/lib/supabase/auth"
import { createSupabaseAdmin } from "@/lib/supabase/admin"
import { isSafeImageUrl, stripControlChars } from "@/lib/validation"
import type { UserProfile } from "@/types/user.types"

const usernameSchema = z
  .string()
  .trim()
  .max(30, "Username must be 30 characters or fewer")
  .regex(/^[a-zA-Z0-9_.-]*$/, "Username may only contain letters, numbers, dots, underscores and hyphens")
  .refine((value) => value.length === 0 || value.length >= 3, "Username must be at least 3 characters")

const bioSchema = z.string().max(280, "Bio must be 280 characters or fewer")

const inputSchema = z.object({
  wallet: z.string().refine(isAddress, "Invalid wallet address"),
  username: usernameSchema,
  bio: bioSchema,
  avatarUrl: z.string().max(2048, "Profile picture URL is too long").nullable().optional(),
})

export type UpdateProfileResult = { success: true; profile: UserProfile } | { success: false; error: string }

export async function updateProfile(input: unknown): Promise<UpdateProfileResult> {
  try {
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid profile data" }
    }

    const wallet = parsed.data.wallet.toLowerCase()
    const username = stripControlChars(parsed.data.username).trim()
    const bio = stripControlChars(parsed.data.bio).trim()
    const avatarUrl = parsed.data.avatarUrl?.trim() || null

    // Verifies the authenticated Supabase session belongs to this wallet.
    const supabase = await requireWalletMatch(wallet)

    if (avatarUrl) {
      if (!isSafeImageUrl(avatarUrl)) {
        return { success: false, error: "Invalid profile picture URL" }
      }

      // Only allow images that actually belong to an NFT owned by this wallet.
      const admin = createSupabaseAdmin()
      const { data: owned, error: ownedError } = await admin
        .from("nfts")
        .select("id")
        .eq("owner_wallet", wallet)
        .eq("image_url", avatarUrl)
        .limit(1)
        .maybeSingle()

      if (ownedError) throw ownedError
      if (!owned) {
        return { success: false, error: "Choose a profile picture from your own NFTs." }
      }
    }

    const admin = createSupabaseAdmin()
    const profileFields = {
      username: username || null,
      bio: bio || null,
      avatar_url: avatarUrl,
    }

    const { data: updated, error: updateError } = await admin
      .from("profiles")
      .update(profileFields)
      .eq("wallet", wallet)
      .select("id, wallet, username, bio, avatar_url, created_at")
      .maybeSingle()

    if (updateError) throw updateError

    let profile = updated

    if (!profile) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return { success: false, error: "Unauthorized" }

      const { data: inserted, error: insertError } = await admin
        .from("profiles")
        .upsert({ id: user.id, wallet, ...profileFields }, { onConflict: "wallet" })
        .select("id, wallet, username, bio, avatar_url, created_at")
        .single()

      if (insertError) throw insertError
      profile = inserted
    }

    revalidatePath(`/user/${wallet}`)
    if (parsed.data.wallet !== wallet) revalidatePath(`/user/${parsed.data.wallet}`)
    return { success: true, profile: profile as UserProfile }
  } catch (error) {
    console.error("updateProfile error:", error)
    const message = error instanceof Error ? error.message : ""
    if (message === "Unauthorized" || message.startsWith("Forbidden")) {
      return { success: false, error: message }
    }
    return { success: false, error: "Unable to update profile. Please try again." }
  }
}
