"use client"

import { FaShoppingCart, FaTrash, FaEthereum } from "react-icons/fa"
import { RiNftFill } from "react-icons/ri"
import { useBuy, useBuyBatch } from "@/hooks/useBuyActions"
import { useTx } from "@/app/context/TxContext"
import { UserNFT } from "@/types/user.types"
import { Address } from "viem"
import { usePublicClient } from "wagmi"
import { Modal } from "@/components/ui/Modal"

interface BuyCardProps {
  items: UserNFT[]
  collectionName?: string
  onClose: () => void
  onSuccess?: (tokenIds: any[]) => void
  onRemoveItem: (item: UserNFT) => void
}

export function BuyCard({ items, collectionName, onClose, onSuccess, onRemoveItem }: BuyCardProps) {
  const { buy } = useBuy()
  const { buyBatch } = useBuyBatch()
  const publicClient = usePublicClient()
  const { addTx, removeTx, updateTx } = useTx()

  const totalPrice = items.reduce((total, item: any) => {
    return total + BigInt(item.price || 0)
  }, BigInt(0))

  const handleBuy = async () => {
    if (!items.length) return

    let hash: any
    try {
      if (items.length > 1) {
        // Compra batch
        const collections = items.map((item) => item.collection_address)
        const tokenIds = items.map((item) => BigInt(item.token_id))

        hash = await buyBatch(collections[0], tokenIds, totalPrice)
        addTx({
          hash,
          status: "loading",
          label: `Buying ${items.length} items...`,
        })
      } else {
        // Compra individual
        const item: any = items[0]
        hash = await buy(item.collection_address, BigInt(item.token_id), BigInt(item.price))
        addTx({
          hash,
          status: "loading",
          label: "Buying item...",
        })
      }

      if (hash && publicClient) {
        await publicClient.waitForTransactionReceipt({ hash })
        updateTx(hash, {
          status: "success",
          label: items.length > 1 ? `Bought ${items.length} items!` : "Item purchased!",
        })
        const tokenIds = items.map((item) => String(item.token_id))
        removeTx(hash)

        onSuccess?.(tokenIds)
        onClose()
      }
    } catch (error) {
      console.error("Buy error:", error)
      if (hash) {
        updateTx(hash, { status: "error", label: "Purchase failed!" })
        removeTx(hash)
      }
    }
  }

  return (
    <Modal
      id="buy-card"
      onClose={onClose}
      title="Buy items"
      icon={<FaShoppingCart className="text-3xl" />}
      panelClassName="min-w-[50%] max-w-[90%] max-h-[80vh]"
    >
          {/* Table header */}
          <div className="flex justify-between px-6 py-3  font-bold ">
            <div className="flex-2">
              <span>Token</span>
            </div>
            <div className="flex-1 text-center">
              <span>Price</span>
            </div>
            <div className="flex-[0.2]" />
          </div>

          {/* Items list - scrollable */}
          <div className="overflow-y-auto max-h-[50vh]">
            {items.map((item: any) => (
              <div key={`${item.collection_address}-${item.token_id}`} className="flex justify-between items-center px-6 py-3  ">
                {/* Token info */}
                <div className="flex flex-2 items-center gap-4">
                  <div className="w-13 rounded-xl overflow-hidden">{item.image_url ? <img src={item.image_url} /> : <RiNftFill className="text-2xl opacity-75" />}</div>

                  <div className="flex flex-col items-start">
                    <span className="font-bold">#{item.token_id}</span>
                    <span className="text-sm opacity-65">{collectionName || item.name || "Unknown"}</span>
                  </div>
                </div>

                {/* Price */}
                <div className="flex flex-1 justify-center items-center gap-2 font-bold">
                  <span>{(Number(item.price) / 1e18).toFixed(4)}</span>
                  <FaEthereum />
                </div>

                {/* Remove button */}
                <div className="flex flex-[0.2] justify-center ">
                  <button onClick={() => onRemoveItem(item)} className="p-2 bg-transparent! hover:text-red-500 transition-colors text-(--text)!">
                    <FaTrash />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="p-4 flex items-center justify-between border-t border-(--text)/20 bg-(--bg)/50">
            <div className="flex  gap-4">
              <span className="text-xl font-bold">Total Price: </span>
              <div className="flex items-center gap-2 text-xl ">
                <span>{(Number(totalPrice) / 1e18).toFixed(4)}</span>
                <FaEthereum />
              </div>
            </div>

            <button
              onClick={handleBuy}
              disabled={!items.length}
              className={`
                rounded flex items-center py-3 px-8 gap-3 font-bold
                ${items.length > 0 ? "bg-(--accent) text-(--bg-secondary) hover:opacity-90" : "bg-(--accent)/30 text-(--text)/50 cursor-not-allowed"}
              `}
            >
              <span>BUY</span>
              <span>{items.length}</span>
              <span>{items.length === 1 ? "ITEM" : "ITEMS"}</span>
            </button>
          </div>
    </Modal>
  )
}
