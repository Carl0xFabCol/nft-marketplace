import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { createSupabaseAdmin } from "@/lib/supabase/admin"

export async function POST() {
  const supabaseAdmin = createSupabaseAdmin()
  const nonce = randomBytes(16).toString("hex")
  const { error } = await supabaseAdmin.from("nonces").insert({
    nonce,
  })
  if (error) {
    return NextResponse.json({ error }, { status: 500 })
  }

  return NextResponse.json({ nonce })
}
