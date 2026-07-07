// app/api/auth/set-cookie/route.ts
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  const { access_token, refresh_token } = await req.json()

  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: "Missing tokens" }, { status: 400 })
  }

  const response = NextResponse.json({ ok: true })

  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7, // 7 días
  }

  response.cookies.set("sb-access-token", access_token, cookieOptions)
  response.cookies.set("sb-refresh-token", refresh_token, cookieOptions)

  return response
}
