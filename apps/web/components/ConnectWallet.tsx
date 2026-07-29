"use client"
import { useEffect, useState } from "react"
import { useDisconnect, useSwitchChain, useBalance, useSignMessage, useConnection } from "wagmi"
import { mainnet, sepolia } from "wagmi/chains"
import { LuWallet } from "react-icons/lu"
import { FaEthereum } from "react-icons/fa"
import { useAuth } from "@/components/AuthProvider"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase/client"

export default function ConnectWallet({ textMsg, setWalletOptionsCard }: any) {
  const router = useRouter()
  const { session } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [loggedIn, setLoggedIn] = useState(!!session)

  useEffect(() => {
    setMounted(true)
    setLoggedIn(!!session)
  }, [session])

  const { address, isConnected, chainId } = useConnection()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const { signMessageAsync } = useSignMessage()

  const { data: balance } = useBalance({
    address,
    query: { enabled: !!address },
  })

  async function loginUser() {
    const nonceRes = await fetch("/api/auth/nonce", { method: "POST" })
    const { nonce } = await nonceRes.json()

    const message = `Bienvenido! nonce: ${nonce}`
    const signature = await signMessageAsync({ message })

    const loginRes = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    })

    const data = await loginRes.json()
    const { access_token, refresh_token, ok } = data

    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token: access_token,
        refresh_token: refresh_token,
      })

      if (error) {
        console.error("Error al establecer la sesión:", error)
        return
      }

      setLoggedIn(true)
      router.push("/")
      router.refresh()
    }
  }

  if (!mounted) return null

  if (isConnected && chainId !== sepolia.id) {
    return (
      <button onClick={() => switchChain({ chainId: sepolia.id })} className="px-3 py-1 rounded">
        Switch to sepolia
      </button>
    )
  }

  if (loggedIn && isConnected) {
    return (
      <div className="flex lg:flex-row flex-col items-center gap-4 lg:border-2 rounded-[10px] border-(--bg)! relative">
        <span className="px-4 p-2 h-full flex items-center lg:border-r border-(--bg) gap-2">
          <span>{balance?.value && (Number(balance.value) / 1e18).toFixed(3)}</span>
          <span className="opacity-75">
            <FaEthereum />
          </span>
        </span>
        <div>{address && <div>{`${address?.slice(0, 6)}...${address?.slice(-6)}`}</div>}</div>
        <button
          onClick={() => {
            setLoggedIn(false)

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
      <button onClick={loginUser} className="px-3 py-1 rounded w-full text-center">
        <span className="flex w-full items-center gap-2 justify-center">Establish connection</span>
      </button>
    )
  }

  return (
    <button onClick={() => setWalletOptionsCard(true)} className="px-3 py-1 rounded w-full text-center">
      <span className="flex w-full items-center gap-2 justify-center">
        {textMsg}
        <LuWallet />
      </span>
    </button>
  )
}
