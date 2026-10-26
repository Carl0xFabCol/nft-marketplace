import { NextResponse, NextRequest } from "next/server"
import { recoverMessageAddress } from "viem"
import { randomBytes, randomUUID } from "crypto"
import { z } from "zod"
import { createSupabaseAdmin } from "@/lib/supabase/admin"
import { clientIp, rateLimit } from "@/lib/rateLimit"

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>

const MAX_BODY_BYTES = 16 * 1024
const NONCE_TTL_MS = 5 * 60 * 1000
const LOGIN_MESSAGE = /^Welcome to Hypermarket!\r?\nLogin to use all its features\.\r?\nNonce: ([a-f0-9]{32})$/i

const loginSchema = z.object({
  signature: z.string().regex(/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/, "Invalid signature"),
  message: z.string().min(1).max(4096),
})

/**
 * Atomically consumes a nonce. The conditional update is what prevents two
 * concurrent login requests from both accepting the same signature.
 */
async function consumeNonce(supabaseAdmin: SupabaseAdmin, nonce: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - NONCE_TTL_MS).toISOString()

  const { data, error } = await supabaseAdmin
    .from("nonces")
    .update({ used: true })
    .eq("nonce", nonce)
    .eq("used", false)
    .gte("created_at", cutoff)
    .select("nonce")
    .maybeSingle()

  if (error) {
    console.error("Nonce validation failed:", error)
    return false
  }

  return Boolean(data)
}

function isSameOrigin(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false

  const origin = request.headers.get("origin")
  if (!origin) return true

  const expectedHost = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0]?.trim()
  if (!expectedHost) return false

  try {
    return new URL(origin).host === expectedHost
  } catch {
    return false
  }
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
  const ip = clientIp(req)
  if (!rateLimit(`login:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many login attempts" }, { status: 429 })
  }

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 })
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 })
  }

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 })
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const parsed = loginSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Lack of data" }, { status: 400 })
  }

  const { signature, message } = parsed.data

  // Only accept the exact message format this app asks the wallet to sign.
  const nonceMatch = message.match(LOGIN_MESSAGE)
  if (!nonceMatch) {
    return NextResponse.json({ error: "Invalid message" }, { status: 400 })
  }

  const supabaseAdmin = createSupabaseAdmin()

  try {
    const wallet = await recoverMessageAddress({ message, signature: signature as `0x${string}` })

    // Consume the nonce only after the signature is known to be valid.
    if (!(await consumeNonce(supabaseAdmin, nonceMatch[1]))) {
      return NextResponse.json({ error: "Invalid nonce" }, { status: 400 })
    }

    const walletAddress = wallet.toLowerCase()

    // ── Look up existing wallet → Supabase user mapping ──────────────
    // The user_wallets table stores a random internal email and a random
    // password per wallet address. Neither is guessable from the wallet
    // address, eliminating the old deterministic ${wallet}@wallet.local
    // credential-derivation weakness.
    const { data: mapping } = await supabaseAdmin.from("user_wallets").select("supabase_user_id, email, supabase_password").eq("wallet_address", walletAddress).single()

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
        console.error("Failed to create user:", createError)
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 })
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
        console.error("Failed to store wallet mapping:", insertError)
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
      console.error("Failed to upsert profile:", profileError)
      return NextResponse.json({ error: "Failed to upsert profile" }, { status: 500 })
    }

    // Sign in server-side using the random password to obtain tokens
    const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError || !signInData?.session) {
      console.error("Failed to create session:", signInError)
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 })
    }

    const { access_token, refresh_token } = signInData.session

    return NextResponse.json(
      {
        ok: true,
        wallet,
        access_token,
        refresh_token,
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }
}
