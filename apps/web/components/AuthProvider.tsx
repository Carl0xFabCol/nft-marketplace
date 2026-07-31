"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { Session } from "@supabase/supabase-js"
import { useConnection } from "wagmi"
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
  const { address, isConnected } = useConnection()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setIsLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Detecta cambio o desconexión de cuenta en la wallet y cierra
  // la sesión de Supabase si ya no corresponde con la wallet conectada.
  useEffect(() => {
    console.log("AuthProvider: address, isConnected, session", address, isConnected, session)
    if (!session) return

    const sessionWallet = session.user.user_metadata?.wallet as string | undefined
    if (!sessionWallet) return

    const mismatch = !isConnected || !address || address.toLowerCase() !== sessionWallet.toLowerCase()

    if (mismatch) {
      supabase.auth.signOut().then(() => {
        setSession(null)
      })
    }
  }, [address, isConnected, session])

  return <AuthContext.Provider value={{ session, isLoading }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
