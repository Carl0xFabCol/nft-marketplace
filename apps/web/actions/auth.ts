"use server"

import { randomBytes } from "crypto"
import { recoverMessageAddress } from "viem"
import { getServerSupabase } from "@/lib/supabase/server"

import { createSupabaseJWT } from "@/lib/auth/jwt"
import { cookies } from "next/headers"

export async function getNonce() {
  const supabase = await getServerSupabase()
  const nonce = randomBytes(16).toString("hex")

  const { error } = await supabase.from("nonces").insert({
    nonce,
  })

  if (error) {
    throw new Error("Failed to generate nonce")
  }

  return { nonce }
}

export async function signIn({ message, signature }: { message: string; signature: `0xstring` }) {
  const supabase = await getServerSupabase()

  // 1. Verify Signature
  try {
    const wallet = await recoverMessageAddress({
      message,
      signature,
    })

    // 2. Verify Nonce
    const match = message.match(/nonce:\s*(\w+)/)
    if (!match) throw new Error("Invalid message format")

    const nonce = match[1]
    const { data: nonceData, error: nonceError } = await supabase.from("nonces").select("*").eq("nonce", nonce).single()

    if (nonceError || !nonceData || nonceData.used) {
      throw new Error("Invalid or used nonce")
    }

    const created = new Date(nonceData.created_at).getTime()
    if (Date.now() - created > 5 * 60 * 1000) {
      throw new Error("Nonce expired")
    }

    // Mark nonce as used
    await supabase.from("nonces").update({ used: true }).eq("nonce", nonce)

    // 3. Create or Find User
    const email = `${wallet.toLowerCase()}@wallet.local`
    let userId: string

    const { data: user, error: userError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
    })

    if (user?.user) {
      userId = user.user.id
    } else if (userError && userError.code?.includes("exists")) {
      const {
        data: { users },
        error: listError,
      } = await supabase.auth.admin.listUsers()
      if (listError) throw new Error("Failed to list users")

      const existing = users.find((u) => u.email === email)
      if (!existing) throw new Error("User exists but not found")
      userId = existing.id
    } else {
      throw new Error(userError?.message || "Failed to create user")
    }

    // 4. Update Profile
    await supabase.from("profiles").upsert({
      id: userId,
      wallet: wallet.toLowerCase(),
    })

    // 5. Generate Custom JWT and Set Cookies
    // We simulate the Supabase session by creating a JWT signed with the same secret
    // and setting the auth cookies that @supabase/ssr expects.
    const token = await createSupabaseJWT({
      aud: "authenticated",
      role: "authenticated",
      sub: userId,
      email: email,
      wallet: wallet.toLowerCase(),
    })

    const cookieStore = await cookies()

    // Supabase auth cookies (simplified version)
    cookieStore.set("sb-access-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
    })

    return { success: true, wallet }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function signOut() {
  const supabase = await getServerSupabase()
  await supabase.auth.signOut()

  const cookieStore = await cookies()
  cookieStore.delete("sb-access-token")

  return { success: true }
}
