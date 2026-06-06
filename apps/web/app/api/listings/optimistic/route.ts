// app/api/listings/optimistic/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { DEFAULT_CHAIN_ID } from "@marketplace/shared"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { txHash, collection, tokenIds, seller, prices, chainId, expiresAts } = body
    console.log(new Date(expiresAts[0] * 1000).toISOString(), new Date().toISOString())

    const authHeader = req.headers.get("Authorization")
    const token = authHeader?.split(" ")[1]
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${token}` } } })

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const rows = tokenIds.map((tokenId: string, i: number) => ({
      tx_hash: txHash,
      collection_address: collection.toLowerCase(),
      listing_id: `${collection.toLowerCase()}-${tokenId}`,
      token_id: tokenId,
      seller_wallet: seller.toLowerCase(),
      price: prices[i],
      chain_id: chainId || DEFAULT_CHAIN_ID,
      is_active: true,
      status: "pending",
      source: "optimistic",
      created_at: new Date(),
      expires_at: new Date(Number(expiresAts[i]) * 1000) || null,
    }))

    // ON CONFLICT targets the pre-existing collection_address + token_id constraint!
    // This allows re-listing items cleanly.
    const { error: dbError } = await supabase.from("listings").upsert(rows, {
      onConflict: "listing_id",
      ignoreDuplicates: false,
    })

    if (dbError) {
      console.error("Database error:", dbError)
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
