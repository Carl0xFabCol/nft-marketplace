"use client"

import { useState } from "react"
import { FaGavel } from "react-icons/fa"
import { HypeIcon } from "@/components/ui/HypeIcon"
import { useBidCollection } from "@/hooks/useBidActions"
import { useTx } from "@/app/context/TxContext"
import { useConnection, usePublicClient } from "wagmi"
import { assertWalletChain, chainGuardErrorMessage } from "@/lib/chainGuard"
import { Address } from "viem"
import ExpirationPicker from "@/components/ui/ExpirationPicker"
import { Modal } from "@/components/ui/Modal"
import { dateToEpochSeconds } from "@/lib/dates"
import { waitForTxConfirmation } from "@/lib/tx"
import { formatWei, parseEtherInput } from "@/lib/wei"

interface ColBidCardProps {
  collectionAddress: Address
  chainId: number
  floorPrice?: bigint
  onClose: () => void
  onSuccess?: () => void
}

export function ColBidCard({ collectionAddress, chainId, floorPrice, onClose, onSuccess }: ColBidCardProps) {
  const [price, setPrice] = useState<string>("")
  const [quantity, setQuantity] = useState<string>("")
  const [expirationDate, setExpirationDate] = useState<Date>(new Date())
  const [formError, setFormError] = useState<string | null>(null)
  const publicClient = usePublicClient({ chainId })
  const { bidCollection } = useBidCollection(chainId)
  const { chainId: connectedChainId } = useConnection()
  const { addTx, removeTx, updateTx } = useTx()

  const priceWei = parseEtherInput(price)
  const quantityN = /^\d+$/.test(quantity) ? BigInt(quantity) : BigInt(0)
  const totalBalance = priceWei !== undefined ? priceWei * quantityN : BigInt(0)

  const updateItemExpirationDate = (expiresAt: Date) => {
    setExpirationDate(expiresAt)
  }
  const handleBid = async () => {
    if (!price || !quantity || Number(quantity) < 1) {
      alert("Please enter valid price and quantity")
      return
    }

    setFormError(null)
    try {
      assertWalletChain(connectedChainId, chainId)
    } catch (error) {
      setFormError(chainGuardErrorMessage(error))
      return
    }

    let hash: `0x${string}` | undefined

    try {
      const bidPrice = parseEtherInput(price)
      if (bidPrice === undefined) throw new Error("Invalid price")
      const qty = Number(quantity)
      hash = await bidCollection(collectionAddress, bidPrice, qty, dateToEpochSeconds(expirationDate))

      addTx({
        hash,
        status: "loading",
        label: "Placing collection bid...",
      })

      await waitForTxConfirmation(publicClient, hash)
      updateTx(hash, {
        status: "success",
        label: "Collection bid placed!",
      })
      setTimeout(() => removeTx(hash!), 5000)

      onSuccess?.()
      onClose()
    } catch (error) {
      console.error("Collection bid error:", error)
      if (hash) {
        updateTx(hash, { status: "error", label: "Bid failed!" })
        setTimeout(() => removeTx(hash!), 6000)
      }
    }
  }

  const updatePrice = (value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return
    setPrice(value)
  }

  const updateQuantity = (value: string) => {
    if (!/^\d*$/.test(value)) return
    setQuantity(value)
  }

  const canBid = priceWei !== undefined && priceWei > BigInt(0) && quantityN > BigInt(0)

  return (
    <Modal
      id="col-bid-card"
      onClose={onClose}
      title="Place Collection Bid"
      icon={<FaGavel className="text-3xl" />}
      panelClassName="min-w-[60%]"
      headerClassName="border-b border-(--text)/20"
    >
          {/* Table header */}
          <div className="flex justify-between px-6 py-3 border-b border-(--text)/20 font-bold bg-(--bg)/50">
            <div className="flex-1 text-center">
              <span>Floor Price</span>
            </div>
            <div className="flex-1 text-center">
              <span>Bid Price</span>
            </div>
            <div className="flex-1 text-center">
              <span>Quantity</span>
            </div>
            <div className="flex-1 text-center">
              <span>Expires at</span>
            </div>
          </div>

          {/* Input fields */}
          <div className="flex justify-between items-center px-6 py-6 border-b border-(--text)/20">
            {/* Floor price display */}
            <div className="flex-1 flex justify-center items-center gap-2 text-lg">
              {floorPrice ? (
                <>
                  <span className="font-bold">{formatWei(floorPrice)}</span>
                  <HypeIcon />
                </>
              ) : (
                <span className="opacity-50">No listings</span>
              )}
            </div>

            {/* Bid price input */}
            <div className="flex-1 flex justify-center">
              <input type="text" inputMode="decimal" value={price} onChange={(e) => updatePrice(e.target.value)} className="rounded p-3 w-full max-w-[150px] text-center" placeholder="0.00" />
            </div>

            {/* Quantity input */}
            <div className="flex-1 flex justify-center">
              <input type="text" inputMode="numeric" value={quantity} onChange={(e) => updateQuantity(e.target.value)} className="rounded p-3 w-full max-w-[150px] text-center" placeholder="1" />
            </div>
            <div className="flex flex-1">
              <ExpirationPicker onChange={(date: Date) => updateItemExpirationDate(date)} />
            </div>
          </div>

          {/* Info section */}
          <div className="px-6 py-4 bg-(--bg-secondary)/50">
            <div className="flex flex-col gap-2 text-sm opacity-75">
              <p>• Your bid will be active for any NFT in this collection</p>
              <p>• Sellers can accept your bid at any time</p>
              <p>• You need sufficient balance for all {quantity || 0} items</p>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 flex items-center justify-between border-t border-(--text)/20">
            {formError && <p className="text-sm text-red-500">{formError}</p>}
            <div className="flex flex-col gap-1">
              <span className="text-sm opacity-75">Total Balance Needed</span>
              <div className="flex items-center gap-2 text-2xl font-bold">
                <span>{formatWei(totalBalance)}</span>
                <HypeIcon />
              </div>
            </div>

            <button
              onClick={handleBid}
              disabled={!canBid}
              className={`
                rounded flex items-center py-3 px-8 gap-3 font-bold
                ${canBid ? "bg-(--accent) text-(--bg-secondary) hover:opacity-90" : "bg-(--accent)/30 text-(--text)/50 cursor-not-allowed"}
              `}
            >
              <span>PLACE BID</span>
            </button>
          </div>
    </Modal>
  )
}
