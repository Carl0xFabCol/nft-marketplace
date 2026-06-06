// app/api/auth/login/route.ts
import { NextResponse } from "next/server"
import { recoverMessageAddress } from "viem"
import { supabase } from "../supabase"

async function validNonce(message: string) {
  const match = message.match(/nonce:\s*(\w+)/)
  if (!match) return false

  const nonce = match[1]

  const { data, error } = await supabase.from("nonces").select("*").eq("nonce", nonce).single()

  if (error || !data) return false
  if (data.used) return false

  const created = new Date(data.created_at).getTime()
  if (Date.now() - created > 5 * 60 * 1000) return false

  await supabase.from("nonces").update({ used: true }).eq("nonce", nonce)
  return true
}

export async function POST(req: Request) {
  const { signature, message } = await req.json()

  if (!signature || !message) {
    return NextResponse.json({ error: "Lack of data" }, { status: 400 })
  }

  try {
    const wallet = await recoverMessageAddress({
      message,
      signature,
    })

    if (!(await validNonce(message))) {
      return NextResponse.json({ error: "Invalid nonce" }, { status: 400 })
    }

    const email = `${wallet.toLowerCase()}@wallet.local`

    let userId: string = ""

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
    })

    if (data?.user) {
      userId = data.user.id
    } else if (error && error.code?.includes("exists")) {
      console.log(error.code)

      const {
        data: { users },
        error: listError,
      } = await supabase.auth.admin.listUsers()

      if (listError) {
        return NextResponse.json({ error: listError }, { status: 500 })
      }

      const existing = users.find((u) => u.email === email)

      if (!existing) {
        return NextResponse.json({ error: "User exists but not found" }, { status: 500 })
      }

      userId = existing.id
    } else if (error) {
      return NextResponse.json({ error }, { status: 400 })
    }

    await supabase.from("profiles").upsert({
      id: userId,
      wallet: wallet.toLowerCase(),
    })
    const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
      },
    })

    if (linkError || !link?.properties?.action_link) {
      return NextResponse.json({ error: linkError }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      wallet,
      actionLink: link.properties.action_link,
    })
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }
}
