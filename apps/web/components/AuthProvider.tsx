"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { Session } from "@supabase/supabase-js"
import { getBrowserSupabase } from "@/lib/supabase/client"

const supabase = getBrowserSupabase()

interface AuthContextType {
  session: Session | null
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  isLoading: true,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      console.log("Session from authprovider: ", session)
      setIsLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={{ session, isLoading }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  console.log("Session from useAuth: ", context.session)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
