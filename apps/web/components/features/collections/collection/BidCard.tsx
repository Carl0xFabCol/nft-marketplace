"use client"

import { useEffect, useState } from "react"
import { FaGavel, FaTrash, FaEthereum } from "react-icons/fa"
import { RiNftFill } from "react-icons/ri"
import { useBidToken, useBidTokenBatch } from "@/hooks/useBidActions"
import { useTx } from "@/app/context/TxContext"
import { UserNFT } from "@/types/user.types"
import { usePublicClient } from "wagmi"
import ExpirationPicker from "@/components/ui/ExpirationPicker"
import { Modal } from "@/components/ui/Modal"
import { dateToEpochSeconds } from "@/lib/dates"

interface BidItemWithPrice extends UserNFT {
  priceEth?: string
  bidPrice?: bigint
}

interface BidCardProps {
  items: UserNFT[]
  collectionAddress: string
  collectionName?: string | null
  onClose: () => void
  onSuccess?: () => void
  onRemoveItem: (item: UserNFT) => void
}

export function BidCard({ items, collectionAddress, collectionName, onClose, onSuccess, onRemoveItem }: BidCardProps) {
  const [priceAll, setPriceAll] = useState<string>("")
  const [bidItems, setBidItems] = useState<BidItemWithPrice[]>(items.map((item) => ({ ...item, priceEth: "", bidPrice: BigInt(0) })))

  const { bidToken } = useBidToken()
  const publicClient = usePublicClient()
  const { bidTokenBatch } = useBidTokenBatch()
  const { addTx, removeTx, updateTx } = useTx()

  useEffect(() => {
    setBidItems(items.map((item) => ({ ...item, priceEth: "", bidPrice: BigInt(0) })))
  }, [items])

  // Total value needed across all bids
  const totalValue = bidItems.reduce((total, item) => {
    return total + (item.bidPrice || BigInt(0))
  }, BigInt(0))

  const handleBid = async () => {
    const validItems = bidItems.filter((item) => item.bidPrice && item.bidPrice > BigInt(0))

    if (!validItems.length) {
      alert("Please set bid prices for all items")
      return
    }

    let hash: any
    try {
      if (validItems.length > 1) {
        // Bid batch
        const tokenIds = validItems.map((item) => BigInt(item.token_id))
        const prices = validItems.map((item) => item.bidPrice as bigint)
        const expiresAts = validItems.map((item: any) => dateToEpochSeconds(item.expiresAt))
        const totalVal = prices.reduce((sum, price) => sum + price, BigInt(0))

        hash = await bidTokenBatch(collectionAddress as `0x${string}`, tokenIds, prices, totalVal, expiresAts)
        addTx({
          hash,
          status: "loading",
          label: `Placing ${validItems.length} bids...`,
        })
      } else {
        // Bid individual
        const item: any = validItems[0]
        hash = await bidToken(collectionAddress as `0x${string}`, BigInt(item.token_id), item.bidPrice as bigint, dateToEpochSeconds(item.expiresAt))
        addTx({
          hash,
          status: "loading",
          label: "Placing bid...",
        })
      }

      if (hash && publicClient) {
        await publicClient.waitForTransactionReceipt({ hash })
        updateTx(hash, {
          status: "success",
          label: validItems.length > 1 ? `${validItems.length} bids placed!` : "Bid placed!",
        })

        removeTx(hash)
        onSuccess?.()
        onClose()
      }
    } catch (error) {
      console.error("Bid error:", error)
      if (hash) {
        updateTx(hash, { status: "error", label: "Bid failed!" })
        removeTx(hash)
      }
    }
  }

  // Update the price of a single item
  const updateItemPrice = (tokenId: string, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return

    const bidPrice = value === "" || value === "." ? undefined : BigInt(Math.floor(Number(value) * 1e18))

    setBidItems((prev) => prev.map((item) => (item.token_id === tokenId ? { ...item, priceEth: value, bidPrice } : item)))
  }

  const updateItemExpirationDate = (tokenId: string, collection: string, expiresAt: Date) => {
    setBidItems((prev) => prev.map((item) => (item.token_id === tokenId && item.collection_address.toLowerCase() === collection.toLowerCase() ? { ...item, expiresAt: expiresAt } : item)))
  }

  // Update the price of all items
  const updateAllPrices = (value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return

    const bidPrice = value === "" || value === "." ? undefined : BigInt(Math.floor(Number(value) * 1e18))

    setPriceAll(value)
    setBidItems((prev) =>
      prev.map((item) => ({
        ...item,
        priceEth: value,
        bidPrice,
      })),
    )
  }

  const canBid = bidItems.some((item) => item.bidPrice && item.bidPrice > BigInt(0))

  return (
    <Modal
      id="bid-card"
      onClose={onClose}
      title="Bid items"
      icon={<FaGavel className="text-3xl" />}
      panelClassName="min-w-[70%] max-w-[90%] max-h-[80vh]"
    >
          {/* Table header */}
          <div className="flex justify-between px-6 py-3 font-bold ">
            <div className="flex-2">
              <span>Token</span>
            </div>
            <div className="flex-1 text-center">
              <span>Listed Price</span>
            </div>
            <div className="flex-1 text-center">
              <span>Your Offer</span>
            </div>
            <div className="flex-1 text-center">
              <span>Expires at</span>
            </div>
            <div className="flex-[0.2]" />
          </div>

          {/* Items list - scrollable */}
          <div className="overflow-y-auto max-h-[50vh]">
            {bidItems.map((item: any) => (
              <div key={`${item.collection_address}-${item.token_id}`} className="flex justify-between items-center p-6 ">
                {/* Token info */}
                <div className="flex flex-2 items-center gap-4">
                  <div className="w-13 rounded-xl overflow-hidden">{item.image_url ? <img src={item.image_url} /> : <RiNftFill className="text-2xl opacity-75" />}</div>

                  <div className="flex flex-col items-start">
                    <span className="font-bold">#{item.token_id}</span>
                    <span className="text-sm opacity-65">{collectionName || item.name || "Unknown"}</span>
                  </div>
                </div>

                {/* Listed price */}
                <div className="flex flex-1 justify-center items-center gap-2">
                  {item.price ? (
                    <>
                      <span>{(Number(item.price) / 1e18).toFixed(4)}</span>
                      <FaEthereum />
                    </>
                  ) : (
                    <span className="opacity-50">-</span>
                  )}
                </div>

                {/* Bid price input */}
                <div className="flex flex-1 justify-center">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={item.priceEth ?? ""}
                    onChange={(e) => updateItemPrice(item.token_id, e.target.value)}
                    className="rounded p-2 text-sm w-[60%]"
                    placeholder="0.00 ETH"
                  />
                </div>

                <div className="flex flex-1">
                  <ExpirationPicker onChange={(date: Date) => updateItemExpirationDate(item.token_id, item.collection_address, date)} />
                </div>

                {/* Remove button */}
                <div className="flex flex-[0.2] justify-center">
                  <button onClick={() => onRemoveItem(item)} className="p-2 bg-transparent! hover:text-red-500 transition-colors text-(--text)!">
                    <FaTrash />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="p-4 flex items-center justify-between border-t border-(--text)/20 bg-(--bg)/50">
            <div className="flex items-center gap-4">
              <span className="text-xl font-bold ">Total balance needed: </span>
              <div className="flex items-center gap-2 text-xl">
                <span>{(Number(totalValue) / 1e18).toFixed(4)}</span>
                <FaEthereum />
              </div>
            </div>
            {/* Set all price */}
            <div className="flex gap-4">
              <div className="flex  ">
                <div className="flex gap-2 items-center">
                  <span className="text-sm">Set all to:</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priceAll}
                    onChange={(e) => updateAllPrices(e.target.value)}
                    className="text-sm rounded w-32 p-2 border border-(--text)/20"
                    placeholder="0.00 ETH"
                  />
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
                <span>BID</span>
                <span>{bidItems.length}</span>
                <span>{bidItems.length === 1 ? "ITEM" : "ITEMS"}</span>
              </button>
            </div>
          </div>
    </Modal>
  )
}
