import { cookies } from "next/headers"
import { verifySupabaseJWT } from "./jwt"

export async function getSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get("sb-access-token")?.value

  if (!token) {
    return null
  }

  const payload = await verifySupabaseJWT(token)
  if (!payload) {
    return null
  }

  return { payload, token }
}
