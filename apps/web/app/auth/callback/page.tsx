"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase/client.ts"

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session) {
        router.replace("/")
      } else {
        router.replace("/?error=auth")
      }
    }

    checkSession()
  }, [router])

  return <p>Signing you in…</p>
}
