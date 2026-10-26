"use client"

import { useState } from "react"
import { useNftStats } from "@/hooks/useMarketplaceReads"
import { useMint } from "@/hooks/useMintActions"
import { explorerTxUrl, SUPPORTED_CHAINS } from "@/lib/chains"
import { motion, AnimatePresence } from "framer-motion"
import { useBalance, useAccount, useChainId } from "wagmi"
import { formatEther } from "viem"
import ConnectWallet from "./ConnectWallet"
import { useTx } from "@/app/context/TxContext"
import { waitForTxConfirmation } from "@/lib/tx"

interface props {
  contractAddress: string
  name: string
}

export function MintForm({ contractAddress, name }: props) {
  const [amount, setAmount] = useState(1)
  const [status, setStatus] = useState<"idle" | "waiting" | "loading" | "success" | "error">("idle")
  const [txHash, setTxHash] = useState<string | null>(null)

  const { mintPrice, maxSupply, totalSupply, isMintActive, refetchTotalSupply } = useNftStats(
    contractAddress as `0x${string}`,
  )
  const { mint, publicClient } = useMint()
  const { addTx, updateTx, removeTx } = useTx()
  const { address } = useAccount()
  const chainId = useChainId()
  const nativeSymbol = SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.nativeCurrency.symbol ?? "HYPE"

  const price = mintPrice ?? BigInt(0)
  const remaining = maxSupply && maxSupply > BigInt(0) ? maxSupply - (totalSupply ?? BigInt(0)) : undefined
  const soldOut = remaining !== undefined && remaining <= BigInt(0)
  const mintEnded = isMintActive === false

  const { refetch: refetchBalance } = useBalance({
    address,
    query: {
      enabled: !!address,
    },
  })

  // Derived validation — no effect needed, so the error can never go stale.
  const error =
    amount < 1 || amount > 500
      ? "Mint amount must be > 0 & < 500"
      : remaining !== undefined && BigInt(amount) > remaining
        ? `Only ${remaining.toString()} left to mint`
        : null

  const getBtnMsg = () => {
    if (status == "idle") {
      return "Mint"
    } else if (status == "waiting") {
      return "Waiting signature..."
    } else if (status == "loading") {
      return "Minting..."
    } else if (status == "success") {
      return "Minted!"
    } else if (status == "error") {
      return "Mint failed!"
    }
  }

  const handleMint = async () => {
    if (error || mintEnded || soldOut) return

    let hash: `0x${string}` | undefined
    try {
      setStatus("waiting")

      hash = await mint(amount, contractAddress as `0x${string}`, address as `0x${string}`, price * BigInt(amount))
      setTxHash(hash)
      addTx({ hash, status: "loading", label: "Minting NFT..." })

      setStatus("loading")

      await waitForTxConfirmation(publicClient, hash)
      refetchBalance()

      updateTx(hash, { status: "success", label: "Minted!" })
      setStatus("success")
      refetchTotalSupply()

      setTimeout(() => removeTx(hash!), 5000)
      setTimeout(() => {
        setStatus("idle")
        setTxHash(null)
      }, 3500)
    } catch (e) {
      if (hash) {
        updateTx(hash, { status: "error", label: "Mint failed!" })
        setTimeout(() => removeTx(hash!), 6000)
      }
      if ((e as { shortMessage?: string })?.shortMessage === "User rejected the request.") {
        setStatus("idle")
      } else {
        setStatus("error")
      }
    }
  }

  const cost = formatEther(price * BigInt(amount))

  return (
    <div className="flex flex-col items-center p-4 gap-2 relative justify-between">
      <div>
        <h2 className="text-2xl mb-2">{name}</h2>
      </div>
      <div className="flex w-full rounded overflow-hidden">
        <button
          onClick={() => {
            if (amount > 1) setAmount(amount - 1)
          }}
          className="flex-1 "
        >
          -
        </button>
        <input type="number" min={1} max={5} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="border-none px-2 bg-(--accent)/30! text-center flex-2" />
        <button
          onClick={() => {
            if (amount < 5) setAmount(amount + 1)
          }}
          className="flex-1 "
        >
          +
        </button>
      </div>
      <span className="text-[12px] text-(--muted)">
        Cost:{" "}
        <span className="text-(--foreground) font-medium">
          {Number(cost).toFixed(Number(cost) < 0.001 ? 6 : 4)} {nativeSymbol}
        </span>
      </span>

      {mintEnded && <p className="text-red-400 text-sm">Minting has ended.</p>}
      {soldOut && <p className="text-red-400 text-sm">Sold out.</p>}

      {(address && (
        <button
          onClick={handleMint}
          disabled={status === "loading" || !!error || mintEnded || soldOut}
          className="px-2 py-1 
   font-semibold
  hover:scale-105 transition
  shadow-lg shadow-[#6366f1]/30
  w-full rounded  "
        >
          {getBtnMsg()}
        </button>
      )) || <ConnectWallet textMsg="Connect " />}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <AnimatePresence>
        {txHash && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="absolute bottom-[-50%]">
            <div className="absolute w-full h-full rounded bg-(--accent) opacity-20 -z-10"></div>
            <div className=" flex flex-row gap-2 items-center  rounded p-2">
              {(status == "loading" || status === "waiting") && (
                <svg className="w-4 h-4 animate-spin text-(--accent)" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="28 56" strokeLinecap="round" />
                </svg>
              )}
              {status == "success" && (
                <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              )}
              {status == "error" && (
                <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-75" />

                  <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-75" />
                </svg>
              )}

              <a target="_blank" href={explorerTxUrl(txHash as string)} className=" hover:opacity-80">
                <span>Tx: </span>
                <span>
                  {txHash?.slice(0, 6)}...{txHash?.slice(-4)}
                </span>
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
