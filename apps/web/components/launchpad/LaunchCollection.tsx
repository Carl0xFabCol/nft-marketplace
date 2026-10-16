"use client"

import { useState } from "react"
import { AnimatePresence } from "framer-motion"
import { Rocket } from "lucide-react"
import { useAccount } from "wagmi"
import { formatEther, decodeEventLog, type Hex } from "viem"
import { useRouter } from "next/navigation"
import { Modal } from "@/components/ui/Modal"
import { useTx } from "@/app/context/TxContext"
import { useContractAddresses } from "@/hooks/useContractAddresses"
import { useCreateCollection, useLaunchpadInfo } from "@/hooks/useLaunchpadActions"
import { LaunchPadABI } from "@/lib/abi"
import { explorerAddressUrl } from "@/lib/chains"

type Status = "idle" | "waiting" | "loading" | "success" | "error"

const isAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value.trim())

const inputClass =
  "w-full rounded-lg border border-(--accent)/30 bg-(--accent)/5 px-3 py-2 focus:outline-none focus:border-(--accent) disabled:opacity-50"

export function LaunchCollection() {
  const router = useRouter()
  const { address } = useAccount()
  const { LAUNCHPAD_CONTRACT_ADDRESS } = useContractAddresses()
  const { launchFee, maxRoyaltyFee, paused } = useLaunchpadInfo()
  const { createCollection, publicClient } = useCreateCollection()
  const { addTx, updateTx, removeTx } = useTx()

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [symbol, setSymbol] = useState("")
  const [royaltyPercent, setRoyaltyPercent] = useState("5")
  const [royaltyReceiver, setRoyaltyReceiver] = useState("")
  const [maxSupply, setMaxSupply] = useState("")
  const [baseURI, setBaseURI] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [createdAddress, setCreatedAddress] = useState<string | null>(null)

  // The factory only exists on chains where it has been deployed (Elysium).
  if (!LAUNCHPAD_CONTRACT_ADDRESS) return null

  const maxRoyaltyPercent = maxRoyaltyFee !== undefined ? Number(maxRoyaltyFee) / 100 : 20
  const effectiveReceiver = royaltyReceiver.trim() || address || ""
  const feePercent = Number(royaltyPercent || 0)
  const feeValid = !Number.isNaN(feePercent) && feePercent >= 0 && feePercent <= maxRoyaltyPercent
  const supplyValid = maxSupply.trim() === "" || /^\d+$/.test(maxSupply.trim())
  const receiverValid = isAddress(effectiveReceiver)
  const busy = status === "waiting" || status === "loading"

  const canSubmit =
    !!address && name.trim() !== "" && symbol.trim() !== "" && feeValid && receiverValid && supplyValid && !paused && !busy

  const launchFeeDisplay = launchFee !== undefined ? formatEther(launchFee) : "0"
  const requiresPayment = launchFee !== undefined && launchFee > BigInt(0)

  const reset = () => {
    setName("")
    setSymbol("")
    setRoyaltyPercent("5")
    setRoyaltyReceiver("")
    setMaxSupply("")
    setBaseURI("")
    setStatus("idle")
    setErrorMsg(null)
    setCreatedAddress(null)
  }

  const close = () => {
    if (busy) return
    setOpen(false)
    reset()
  }

  const getBtnMsg = () => {
    switch (status) {
      case "waiting":
        return "Waiting signature..."
      case "loading":
        return "Launching..."
      case "success":
        return "Collection launched!"
      case "error":
        return "Launch failed"
      default:
        return requiresPayment ? `Launch for ${launchFeeDisplay} HYPE` : "Launch collection"
    }
  }

  const handleCreate = async () => {
    if (!canSubmit) return
    setErrorMsg(null)

    let hash: `0x${string}` | undefined
    try {
      setStatus("waiting")

      hash = await createCollection(
        {
          name: name.trim(),
          symbol: symbol.trim(),
          royaltyFee: Math.round(feePercent * 100),
          royaltyReceiver: effectiveReceiver as `0x${string}`,
          maxSupply: maxSupply.trim() === "" ? BigInt(0) : BigInt(maxSupply.trim()),
          baseURI: baseURI.trim(),
        },
        launchFee ?? BigInt(0),
      )

      addTx({ hash, status: "loading", label: "Launch collection" })
      setStatus("loading")

      if (!publicClient) throw new Error("No public client available")
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status === "reverted") throw new Error("Transaction reverted")

      for (const log of receipt.logs) {
        try {
          const decoded: any = decodeEventLog({
            abi: LaunchPadABI,
            data: log.data,
            topics: log.topics as [Hex, ...Hex[]],
          })
          if (decoded?.eventName === "CollectionDeployed") {
            setCreatedAddress(decoded.args.collection as string)
            break
          }
        } catch {
          // log belongs to another contract; ignore
        }
      }

      updateTx(hash, { status: "success" })
      setStatus("success")
      router.refresh()

      setTimeout(() => {
        removeTx(hash!)
        setOpen(false)
        reset()
      }, 5000)
    } catch (e: any) {
      if (hash) {
        updateTx(hash, { status: "error" })
        removeTx(hash)
      }
      if (e?.shortMessage === "User rejected the request.") {
        setStatus("idle")
      } else {
        setStatus("error")
        setErrorMsg(e?.shortMessage || e?.message || "Transaction failed")
      }
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!!paused}
        className="flex items-center gap-2 rounded-lg px-4 py-2 bg-(--accent) text-black font-semibold hover:opacity-90 transition self-start disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Rocket className="w-4 h-4" />
        Launch collection
      </button>

      <AnimatePresence>
        {open && (
          <Modal
            id="launch-collection"
            onClose={close}
            title="Launch a new collection"
            icon={<Rocket className="w-5 h-5 text-(--accent)" />}
            panelClassName="w-full max-w-lg"
          >
            <div className="flex flex-col gap-4 p-6 pt-2 overflow-y-auto max-h-[70vh]">
              <p className="text-sm text-(--muted)">
                Deploy your own ERC-721 collection. It is registered on the marketplace automatically.
              </p>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-(--muted)">Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Awesome Collection"
                  maxLength={64}
                  disabled={busy}
                  className={inputClass}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-(--muted)">Symbol</span>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="MAC"
                  maxLength={16}
                  disabled={busy}
                  className={inputClass}
                />
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm text-(--muted)">Royalty (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={maxRoyaltyPercent}
                    step="0.5"
                    value={royaltyPercent}
                    onChange={(e) => setRoyaltyPercent(e.target.value)}
                    placeholder="5"
                    disabled={busy}
                    className={inputClass}
                  />
                  <span className="text-xs text-(--muted)">Max {maxRoyaltyPercent}%</span>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-sm text-(--muted)">Max supply</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={maxSupply}
                    onChange={(e) => setMaxSupply(e.target.value)}
                    placeholder="0"
                    disabled={busy}
                    className={inputClass}
                  />
                  <span className="text-xs text-(--muted)">0 = unlimited</span>
                </label>
              </div>

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
                {royaltyReceiver.trim() !== "" && !receiverValid && <span className="text-xs text-red-400">Enter a valid address.</span>}
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-(--muted)">Base URI (optional)</span>
                <input
                  type="text"
                  value={baseURI}
                  onChange={(e) => setBaseURI(e.target.value)}
                  placeholder="ipfs://.../"
                  disabled={busy}
                  className={inputClass}
                />
              </label>

              {!address && <p className="text-sm text-amber-400">Connect your wallet to launch a collection.</p>}
              {paused && <p className="text-sm text-red-400">The launchpad is currently paused.</p>}
              {status === "error" && errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}

              {status === "success" && createdAddress && (
                <p className="text-sm text-green-400">
                  Launched at{" "}
                  <a href={explorerAddressUrl(createdAddress)} target="_blank" className="underline hover:opacity-80">
                    {createdAddress.slice(0, 6)}...{createdAddress.slice(-4)}
                  </a>
                </p>
              )}

              <button
                onClick={handleCreate}
                disabled={!canSubmit}
                className="rounded-lg bg-(--accent) text-black font-semibold py-2.5 hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {getBtnMsg()}
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  )
}
