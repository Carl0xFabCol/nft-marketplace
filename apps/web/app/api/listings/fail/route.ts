import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: Request) {
  const { txHash } = await req.json()

  const supabase = await createClient()

  await supabase.from("listings").update({ status: "failed", is_active: false }).eq("tx_hash", txHash)
  return NextResponse.json({ ok: true })
}
