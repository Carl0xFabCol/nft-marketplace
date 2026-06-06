"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { FaGavel, FaTimes, FaEthereum } from "react-icons/fa"
import { useBidCollection } from "@/hooks/Contract"
import { useTx } from "@/app/context/TxContext"
import { usePublicClient } from "wagmi"
import { Address } from "viem"
import ExpirationPicker from "@/components/ui/ExpirationPicker"

interface ColBidCardProps {
  collectionAddress: Address
  floorPrice?: bigint
  onClose: () => void
  onSuccess?: () => void
}

export function ColBidCard({ collectionAddress, floorPrice, onClose, onSuccess }: ColBidCardProps) {
  const [price, setPrice] = useState<string>("")
  const [quantity, setQuantity] = useState<string>("")
  const [expirationDate, setExpirationDate] = useState<Date>(new Date())
  const publicClient = usePublicClient()
  const { bidCollection } = useBidCollection()
  const { addTx, removeTx, updateTx } = useTx()

  const totalBalance = price && quantity ? Number(price) * Number(quantity) : 0

  const updateItemExpirationDate = (expiresAt: Date) => {
    setExpirationDate(expiresAt)
  }
  const handleBid = async () => {
    if (!price || !quantity || Number(quantity) < 1) {
      alert("Please enter valid price and quantity")
      return
    }

    let hash: any

    try {
      const bidPrice = BigInt(Math.floor(Number(price) * 1e18))
      const qty = Number(quantity)
      hash = await bidCollection(collectionAddress, bidPrice, qty, expirationDate.getTime())

      addTx({
        hash,
        status: "loading",
        label: "Placing collection bid...",
      })

      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash })
        updateTx(hash, {
          status: "success",
          label: "Collection bid placed!",
        })
        removeTx(hash)

        setTimeout(() => {
          onSuccess?.()
          onClose()
        }, 2000)
      }
    } catch (error) {
      console.error("Collection bid error:", error)
      if (hash) {
        updateTx(hash, { status: "error", label: "Bid failed!" })
        removeTx(hash)
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

  const canBid = price && quantity && Number(price) > 0 && Number(quantity) > 0

  return (
    <AnimatePresence>
      <motion.div
        id="col-bid-card-bg"
        onClick={(e: any) => {
          if (e.target.id === "col-bid-card-bg") {
            onClose()
          }
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-center items-center z-50"
      >
        <motion.div
          initial={{ opacity: 0, translateY: 50 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: 50 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col card rounded-2xl border border-(--text)/20 min-w-[60%] "
        >
          {/* Header */}
          <div className="p-4 flex justify-between items-center border-b border-(--text)/20">
            <div className="flex items-center gap-3">
              <FaGavel className="text-3xl" />
              <span className="font-bold text-2xl">Place Collection Bid</span>
            </div>
            <button onClick={onClose} className="bg-transparent! text-(--text)! hover:opacity-75">
              <FaTimes className="opacity-75" />
            </button>
          </div>

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
                  <span className="font-bold">{(Number(floorPrice) / 1e18).toFixed(4)}</span>
                  <FaEthereum />
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
            <div className="flex flex-col gap-1">
              <span className="text-sm opacity-75">Total Balance Needed</span>
              <div className="flex items-center gap-2 text-2xl font-bold">
                <span>{totalBalance.toFixed(4)}</span>
                <FaEthereum />
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
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
