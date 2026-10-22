// components/RegisterCollection.tsx
"use client"

import { useState } from "react"
import { AnimatePresence } from "framer-motion"
import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRegisterCollection } from "../hooks/useCollectionActions"
import { useIsMarketplaceAdmin } from "@/hooks/useMarketplaceReads"
import { useTx } from "@/app/context/TxContext"
import { useConnection } from "wagmi"
import { Modal } from "@/components/ui/Modal"

const inputClass = "w-full rounded-lg border border-(--accent)/30 bg-(--accent)/5 px-3 py-2 focus:outline-none focus:border-(--accent) disabled:opacity-50"

export function RegisterCollection() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [collectionAddress, setCollectionAddress] = useState("")
  const [royaltyFee, setRoyaltyFee] = useState("")
  const [royaltyReceiver, setRoyaltyReceiver] = useState("")
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

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
  const canSubmit = !!collectionAddress.trim() && !!royaltyFee && isValidReceiver && !busy

  const reset = () => {
    setCollectionAddress("")
    setRoyaltyFee("")
    setRoyaltyReceiver("")
    setErrorMsg(null)
  }

  const close = () => {
    if (busy) return
    setOpen(false)
    reset()
  }

  const handleRegister = async () => {
    if (!canSubmit) return

    let hash: `0x${string}` | undefined
    try {
      setBusy(true)
      setErrorMsg(null)

      const fee = BigInt(Number(royaltyFee) * 100)
      hash = await registerCollection(collectionAddress.trim() as `0x${string}`, fee, effectiveReceiver as `0x${string}`)
      addTx({ hash, status: "loading", label: "Register collection" })

      const receipt = await publicClient?.waitForTransactionReceipt({ hash })
      if (receipt && receipt.status !== "success") throw new Error("Transaction reverted")

      updateTx(hash, { status: "success" })
      setTimeout(() => removeTx(hash!), 3000)
      setOpen(false)
      reset()
      router.refresh()
    } catch (e) {
      if (hash) {
        updateTx(hash, { status: "error" })
        removeTx(hash)
      }
      const err = e as { shortMessage?: string; message?: string }
      if (err?.shortMessage === "User rejected the request.") {
        setErrorMsg(null)
      } else {
        setErrorMsg(err?.shortMessage || err?.message || "Transaction failed")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg px-4 py-2 bg-(--accent) text-black font-semibold hover:opacity-90 transition self-start disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus className="w-4 h-4" />
        Register collection
      </button>

      <AnimatePresence>
        {open && (
          <Modal id="register-collection" onClose={close} title="Register a collection" icon={<Plus className="w-5 h-5 text-(--accent)" />} panelClassName="w-full max-w-lg">
            <div className="flex flex-col gap-4 p-6 pt-2 overflow-y-auto max-h-[70vh]">
              <p className="text-sm text-(--muted)">Register an existing ERC-721 collection so it can be traded on the marketplace.</p>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-(--muted)">Contract address</span>
                <input
                  type="text"
                  value={collectionAddress}
                  onChange={(e) => setCollectionAddress(e.target.value)}
                  placeholder="0x1234..."
                  disabled={busy}
                  className={inputClass}
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
                  disabled={busy}
                  className={inputClass}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-(--muted)">Royalty receiver</span>
                <input
                  type="text"
                  value={royaltyReceiver}
                  onChange={(e) => setRoyaltyReceiver(e.target.value)}
                  placeholder={address ?? "0x1234..."}
                  disabled={busy}
                  className={inputClass}
                />
                <span className="text-xs text-(--muted)">Defaults to your connected wallet.</span>
                {!isValidReceiver && <span className="text-xs text-red-400">Enter a valid address.</span>}
              </label>

              {errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}

              <button
                onClick={handleRegister}
                disabled={!canSubmit}
                className="rounded-lg bg-(--accent) text-black font-semibold py-2.5 hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? "Registering..." : "Register collection"}
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  )
}
