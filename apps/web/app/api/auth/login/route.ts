import { NextResponse, NextRequest } from "next/server"
import { recoverMessageAddress } from "viem"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { randomBytes, randomUUID } from "crypto"

async function validateNonce(message: string): Promise<boolean> {
  const match = message.match(/nonce:\s*(\w+)/i)
  if (!match) {
    return false
  }

  const nonce = match[1]
  const { data, error } = await supabaseAdmin.from("nonces").select("*").eq("nonce", nonce).single()

  if (error || !data) {
    return false
  }
  if (data.used) {
    return false
  }

  const created = new Date(data.created_at).getTime()
  if (Date.now() - created > 5 * 60 * 1000) {
    return false
  }

  await supabaseAdmin.from("nonces").update({ used: true }).eq("nonce", nonce)
  return true
}

/**
 * Generates a cryptographically strong random password (≥ 32 chars,
 * alphanumeric + symbols). Used solely to establish a Supabase session
 * after wallet signature verification — never exposed to the client.
 */
function generateSecurePassword(): string {
  return randomBytes(32).toString("base64url")
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { signature, message } = await req.json()

  if (!signature || !message) {
    return NextResponse.json({ error: "Lack of data" }, { status: 400 })
  }

  try {
    const wallet = await recoverMessageAddress({ message, signature })

    // Validate nonce using admin client
    if (!(await validateNonce(message))) {
      return NextResponse.json({ error: "Invalid nonce" }, { status: 400 })
    }

    const walletAddress = wallet.toLowerCase()

    // ── Look up existing wallet → Supabase user mapping ──────────────
    // The user_wallets table stores a random internal email and a random
    // password per wallet address. Neither is guessable from the wallet
    // address, eliminating the old deterministic ${wallet}@wallet.local
    // credential-derivation weakness.
    const { data: mapping, error: lookupError } = await supabaseAdmin.from("user_wallets").select("supabase_user_id, email, supabase_password").eq("wallet_address", walletAddress).single()

    let email: string
    let password: string
    let userId: string

    if (mapping) {
      // Existing user — reuse the stored random credentials to sign in
      userId = mapping.supabase_user_id
      email = mapping.email
      password = mapping.supabase_password

      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { wallet: walletAddress },
      })
    } else {
      // New user — create a Supabase Auth user with a random email + password
      email = `user_${randomUUID()}@internal.local`
      password = generateSecurePassword()

      const { data: createUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { wallet: walletAddress },
      })

      if (createError || !createUser?.user) {
        return NextResponse.json({ error: createError ?? "Failed to create user" }, { status: 500 })
      }

      userId = createUser.user.id

      // Store the wallet → user mapping (password kept server-side only)
      const { error: insertError } = await supabaseAdmin.from("user_wallets").insert({
        wallet_address: walletAddress,
        supabase_user_id: userId,
        email,
        supabase_password: password,
      })

      if (insertError) {
        return NextResponse.json({ error: "Failed to store wallet mapping" }, { status: 500 })
      }
    }

    // Upsert profile with wallet address
    const { error: profileError } = await supabaseAdmin.from("profiles").upsert(
      {
        id: userId,
        wallet: walletAddress,
      },
      { onConflict: "wallet" },
    )

    if (profileError) {
      return NextResponse.json({ error: "Failed to upsert profile" }, { status: 500 })
    }

    // Sign in server-side using the random password to obtain tokens
    const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError || !signInData?.session) {
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 })
    }

    const { access_token, refresh_token } = signInData.session

    return NextResponse.json({
      ok: true,
      wallet,
      access_token,
      refresh_token,
    })
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }
}
