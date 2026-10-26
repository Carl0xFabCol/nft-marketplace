"use client"
import { useState, useSyncExternalStore } from "react"
import { useDisconnect, useSwitchChain, useBalance, useSignMessage, useConnection } from "wagmi"
import { LuWallet } from "react-icons/lu"
import { CHAIN_ID, SUPPORTED_CHAIN_IDS } from "@/lib/chains"
import { HypeIcon } from "@/components/ui/HypeIcon"
import { useAuth } from "@/components/AuthProvider"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase/client"

interface ConnectWalletProps {
  textMsg: string
  setWalletOptionsCard?: (open: boolean) => void
}

const emptySubscribe = () => () => {}

export default function ConnectWallet({ textMsg, setWalletOptionsCard }: ConnectWalletProps) {
  const router = useRouter()
  const { session } = useAuth()
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )
  const loggedIn = !!session
  const [error, setError] = useState<string | null>(null)

  const { address, isConnected, chainId } = useConnection()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const { signMessageAsync } = useSignMessage()

  const { data: balance } = useBalance({
    address,
    query: { enabled: !!address },
  })

  async function loginUser() {
    setError(null)

    try {
      const nonceRes = await fetch("/api/auth/nonce", { method: "POST" })
      const nonceData = await nonceRes.json().catch(() => null)

      if (!nonceRes.ok || !nonceData?.nonce) {
        setError("Could not start the login. Please try again.")
        return
      }

      const { nonce } = nonceData
      const message = `Welcome to Hypermarket!\nLogin to use all its features.\nNonce: ${nonce}`
      const signature = await signMessageAsync({ message })

      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      })

      const data = await loginRes.json()

      if (!loginRes.ok || !data.access_token || !data.refresh_token) {
        setError(data.error ?? "Login failed. Please try again.")
        return
      }

      const { access_token, refresh_token } = data
      const { error: sessionError } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      })

      if (sessionError) {
        console.error("Error establishing the session:", sessionError)
        setError("Could not establish the session. Please try again.")
        return
      }

      router.push("/")
      router.refresh()
    } catch (err) {
      console.error("Login error:", err)
      setError("Login failed. Please try again.")
    }
  }

  if (!mounted) return null

  if (isConnected && !SUPPORTED_CHAIN_IDS.includes(chainId ?? -1)) {
    return (
      <button onClick={() => switchChain({ chainId: CHAIN_ID })} className="px-3 py-1 rounded">
        Switch network
      </button>
    )
  }

  if (loggedIn && isConnected) {
    return (
      <div className="flex lg:flex-row flex-col items-center gap-4 lg:border-2 rounded-[10px] border-(--bg)! relative">
        <span className="px-4 p-2 h-full flex items-center lg:border-r border-(--bg) gap-2">
          <span>{balance?.value && (Number(balance.value) / 1e18).toFixed(3)}</span>
          <span className="opacity-75">
            <HypeIcon />
          </span>
        </span>
        <div>{address && <div>{`${address?.slice(0, 6)}...${address?.slice(-6)}`}</div>}</div>
        <button
          onClick={() => {
            disconnect()
          }}
          className="px-3 bg-transparent! text-(--accent)! py-1 h-full rounded lg:rounded-none"
        >
          DISCONNECT
        </button>
      </div>
    )
  }

  if (isConnected && !loggedIn) {
    return (
      <div className="w-full">
        <button onClick={loginUser} className="px-3 py-1 rounded w-full text-center">
          <span className="flex w-full items-center gap-2 justify-center">Establish connection</span>
        </button>
        {error && <p className="mt-1 text-xs text-red-400 text-center">{error}</p>}
      </div>
    )
  }

  return (
    <button onClick={() => setWalletOptionsCard?.(true)} className="px-3 py-1 rounded w-full text-center">
      <span className="flex w-full items-center gap-2 justify-center">
        {textMsg}
        <LuWallet />
      </span>
    </button>
  )
}
