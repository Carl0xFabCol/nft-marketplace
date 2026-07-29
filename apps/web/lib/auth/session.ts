import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase/admin"

/**
 * Get the current session from Supabase auth cookies.
 * This validates the session using the Supabase admin client.
 */
export async function getSession(): Promise<{ user: any; token: string } | null> {
  const cookieStore = await cookies()

  // Get the access token from the cookie
  const accessToken = cookieStore.get("sb-access-token")?.value
  const refreshToken = cookieStore.get("sb-refresh-token")?.value

  if (!accessToken) {
    return null
  }

  // Verify the session using the admin client
  // This checks if the token is valid and not expired
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken)

  if (error || !user) {
    return null
  }

  return { user, token: accessToken }
}

/**
 * Require authentication - throws if not authenticated.
 * Use in server actions and API routes.
 */
export async function requireAuth(): Promise<{ user: any; token: string }> {
  const session = await getSession()
  if (!session) {
    throw new Error("Unauthorized")
  }
  return session
}
