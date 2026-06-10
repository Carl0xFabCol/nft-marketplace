import * as jose from "jose"

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET!

export async function signSupabaseJWT(walletAddress: string): Promise<string> {
  const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET)

  return await new jose.SignJWT({
    sub: walletAddress,
    role: "authenticated",
    aud: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret)
}

export async function createSupabaseJWT(payload: any) {
  const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET)

  return await new jose.SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("24h").sign(secret)
}

export async function verifySupabaseJWT(token: string) {
  const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET)
  try {
    const { payload } = await jose.jwtVerify(token, secret)
    return payload
  } catch (e) {
    return null
  }
}
