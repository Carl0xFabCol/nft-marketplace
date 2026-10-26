import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { createSupabaseAdmin } from "@/lib/supabase/admin"
import { clientIp, rateLimit } from "@/lib/rateLimit"

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!rateLimit(`nonce:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const supabaseAdmin = createSupabaseAdmin()
  const nonce = randomBytes(16).toString("hex")

  const { error } = await supabaseAdmin.from("nonces").insert({ nonce })

  if (error) {
    console.error("Failed to create nonce:", error)
    return NextResponse.json({ error: "Failed to create nonce" }, { status: 500 })
  }

  return NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } })
}
