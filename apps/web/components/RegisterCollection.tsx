// components/RegisterCollection.tsx
"use client"

import { useState } from "react"
import { FaTimes } from "react-icons/fa"
import { Plus } from "lucide-react"
import { useRegisterCollection } from "../hooks/useCollectionActions"
import { useIsMarketplaceAdmin } from "@/hooks/useMarketplaceReads"
import { useTx } from "@/app/context/TxContext"
import { useConnection } from "wagmi"

export function RegisterCollection() {
  const [open, setOpen] = useState(false)
  const [collectionAddress, setCollectionAddress] = useState("")
  const [royaltyFee, setRoyaltyFee] = useState("")
  const [royaltyReceiver, setRoyaltyReceiver] = useState("")

  const { addTx, removeTx, updateTx } = useTx()
  const { registerCollection, publicClient } = useRegisterCollection()
  const { address } = useConnection()
  const { isAdmin } = useIsMarketplaceAdmin()

  // External collections can only be registered by the marketplace owner/admin.
  // Collections launched through the Launchpad are registered automatically.
  if (!isAdmin) return null

  const isAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value.trim())
  const effectiveReceiver = royaltyReceiver.trim() || address || ""
  const isValidReceiver = isAddress(effectiveReceiver)

  const handleRegister = async () => {
    let hash: `0x${string}` | undefined
    try {
      const _fee = BigInt(Number(royaltyFee) * 100)
      hash = await registerCollection(collectionAddress as `0x${string}`, _fee, effectiveReceiver as `0x${string}`)
      addTx({ hash, status: "loading", label: "Register collection" })
      await publicClient?.waitForTransactionReceipt({ hash })
      updateTx(hash, { status: "success" })
      setTimeout(() => removeTx(hash!), 3000)
      setOpen(false)
    } catch {
      if (hash) {
        updateTx(hash, { status: "error" })
        removeTx(hash)
      }
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-lg px-4 py-2 border border-(--accent) text-(--accent) hover:bg-(--accent)/10 transition self-start">
        <Plus className="w-4 h-4" />
        Register collection
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-(--accent)/30 bg-(--background) p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-xl font-bold">Register your collection</h2>
              <button onClick={() => setOpen(false)} className="text-(--muted) hover:text-(--accent)">
                <FaTimes />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-(--muted)">Contract address</span>
                <input
                  type="text"
                  value={collectionAddress}
                  onChange={(e) => setCollectionAddress(e.target.value)}
                  placeholder="0x1234..."
                  className="w-full rounded-lg border border-(--accent)/30 bg-(--accent)/5 px-3 py-2 focus:outline-none focus:border-(--accent)"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-(--muted)">Royalty fee (%)</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={royaltyFee}
                  onChange={(e) => setRoyaltyFee(e.target.value)}
                  placeholder="5"
                  className="w-full rounded-lg border border-(--accent)/30 bg-(--accent)/5 px-3 py-2 focus:outline-none focus:border-(--accent)"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-(--muted)">Royalty receiver</span>
                <input
                  type="text"
                  value={royaltyReceiver}
                  onChange={(e) => setRoyaltyReceiver(e.target.value)}
                  placeholder={address ?? "0x1234..."}
                  className="w-full rounded-lg border border-(--accent)/30 bg-(--accent)/5 px-3 py-2 focus:outline-none focus:border-(--accent)"
                />
                <span className="text-xs text-(--muted)">Defaults to your connected wallet.</span>
                {!isValidReceiver && <span className="text-xs text-red-400">Enter a valid address.</span>}
              </label>

              <button
                onClick={handleRegister}
                disabled={!collectionAddress || !royaltyFee || !isValidReceiver}
                className="rounded-lg bg-(--accent) text-black font-semibold py-2.5 hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Register
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
