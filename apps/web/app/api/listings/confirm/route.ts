import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms))

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { txHash } = body

    const authHeader = req.headers.get("Authorization")
    const token = authHeader?.split(" ")[1]
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 })

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${token}` } } })

    let attempts = 5
    let updatedRows = 0

    while (attempts > 0 && updatedRows === 0) {
      const { data, error, count } = await supabase.from("listings").update({ status: "confirmed", is_active: true }).eq("tx_hash", txHash).select() // Select returns the updated row count

      updatedRows = data?.length || 0
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      if (updatedRows === 0) {
        attempts--
        if (attempts > 0) await delay(500) // Wait 500ms for /optimistic to write
      }
    }

    return NextResponse.json({ ok: true, synchronized: updatedRows > 0 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
