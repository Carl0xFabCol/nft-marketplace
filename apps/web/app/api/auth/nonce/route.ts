import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { supabase } from "@/lib/supabase/client"

export async function POST() {
  const nonce = randomBytes(16).toString("hex")
  const { error } = await supabase.from("nonces").insert({
    nonce,
  })
  if (error) {
    return NextResponse.json({ error }, { status: 500 })
  }

  return NextResponse.json({ nonce })
}
