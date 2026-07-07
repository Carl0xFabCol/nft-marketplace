// lib/auth/jwt.ts
import * as jwt from "jsonwebtoken"

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET!

export async function generateSupabaseCustomToken(userId: string) {
  // 1. El Access Token (Válido por 1 hora)
  const accessToken = jwt.sign(
    {
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
      app_metadata: { provider: "custom", providers: ["custom"] },
      user_metadata: { wallet_authenticated: true },
    },
    SUPABASE_JWT_SECRET,
    { expiresIn: "1h" },
  )

  // 2. El Refresh Token Ficticio (Válido por ejemplo por 7 días)
  // Debe estar firmado con el mismo secreto para que pase los filtros iniciales de GoTrue
  const refreshToken = jwt.sign(
    {
      sub: userId,
      type: "refresh", // Marcador para identificarlo internamente si fuese necesario
    },
    SUPABASE_JWT_SECRET,
    { expiresIn: "7d" },
  )

  return { accessToken, refreshToken }
}

export async function verifySupabaseJWT(token: string) {
  if (!SUPABASE_JWT_SECRET) return null
  try {
    const payload = jwt.verify(token, SUPABASE_JWT_SECRET)
    return payload
  } catch (e) {
    return null
  }
}
