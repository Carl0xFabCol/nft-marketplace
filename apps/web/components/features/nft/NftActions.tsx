"use client"

import { useState } from "react"
import { useAccount } from "wagmi"
import { useRouter } from "next/navigation"
import { FaShoppingCart, FaGavel, FaTag } from "react-icons/fa"
import { HypeIcon } from "@/components/ui/HypeIcon"
import { MdLocalOffer, MdCancel } from "react-icons/md"
import { useBuy } from "@/hooks/useBuyActions"
import { useCancelList } from "@/hooks/useListingActions"
import { useBidTokenBatch } from "@/hooks/useBidActions"
import { useTx } from "@/app/context/TxContext"
import { BidCard } from "../collections/collection/BidCard"
import { useBatchOperations } from "@/hooks/useBatchOperations"
import { BatchNFT, NFTDetail } from "@/types/user.types"
import { waitForTxConfirmation } from "@/lib/tx"

interface NFTActionsProps {
  nft: NFTDetail
}

export function NFTActions({ nft }: NFTActionsProps) {
  const router = useRouter()
  const { address: userAddress } = useAccount()
  const [showBidModal, setShowBidModal] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const { removeFromBatch, clearBatch, addToBatch, bidBatch } = useBatchOperations()
  const { buy } = useBuy()
  const { cancelList } = useCancelList()
  const { publicClient } = useBidTokenBatch()
  const { addTx, updateTx, removeTx } = useTx()

  const isOwner = userAddress?.toLowerCase() === nft.owner_wallet.toLowerCase()
  const isListed = Boolean(nft.listing?.is_active)
  const isSeller = userAddress?.toLowerCase() === nft.listing?.seller_wallet?.toLowerCase()
  // The bid batch stores tokens as BatchNFT; NFTDetail is a superset.
  const nftForBatch = nft as unknown as BatchNFT

  // Handler for buying the NFT
  const handleBuy = async () => {
    if (!nft.listing || !userAddress) return

    setIsProcessing(true)
    let hash: `0x${string}` | undefined

    try {
      const price = BigInt(nft.listing.price)

      hash = await buy(nft.collection_address, BigInt(nft.token_id), price)

      addTx({
        hash,
        status: "loading",
        label: "Buying NFT...",
      })

      await waitForTxConfirmation(publicClient, hash)
      updateTx(hash, {
        status: "success",
        label: "NFT purchased successfully!",
      })
      setTimeout(() => removeTx(hash!), 5000)

      // Refetch the server component data in place (no full reload).
      router.refresh()
    } catch (error) {
      console.error("Buy error:", error)
      if (hash) {
        updateTx(hash, { status: "error", label: "Purchase failed!" })
        setTimeout(() => removeTx(hash!), 6000)
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const formatDate = (timestamp: string | null | undefined) => {
    const date = new Date(timestamp ?? 0)
    return new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date)
  }

  // Handler for cancelling the listing
  const handleCancelListing = async () => {
    if (!nft.listing || !userAddress) return

    setIsProcessing(true)
    let hash: `0x${string}` | undefined

    try {
      hash = await cancelList(nft.collection_address, Number(nft.token_id))

      addTx({
        hash,
        status: "loading",
        label: "Cancelling listing...",
      })

      await waitForTxConfirmation(publicClient, hash)
      updateTx(hash, {
        status: "success",
        label: "Listing cancelled!",
      })
      setTimeout(() => removeTx(hash!), 5000)

      router.refresh()
    } catch (error) {
      console.error("Cancel listing error:", error)

      if (hash) {
        updateTx(hash, { status: "error", label: "Cancellation failed!" })
        setTimeout(() => removeTx(hash!), 6000)
      }
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Current price */}
      {isListed && (
        <div className="bg-(--bg) rounded-xl p-6 border border-(--text)/20">
          <div className="flex flex-col gap-2">
            <span className="text-sm opacity-75">Current Price</span>
            <div className="flex items-center gap-2">
              <HypeIcon className="text-3xl" />
              <span className="text-4xl font-bold">{(Number(nft.listing!.price) / 1e18).toFixed(4)}</span>
            </div>

            {/* Price details */}
            {nft.collection?.royalty_fee && (
              <div className="text-xs opacity-75 mt-2 flex justify-between">
                <div>Expires at: {formatDate(nft.listing!.expires_at)}</div>
                <div>Creator royalty: {nft.collection.royalty_fee / 100}%</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-2">
        {!userAddress ? (
          <div className="card rounded-xl p-4 text-center opacity-75">
            <p>Connect your wallet to interact with this NFT</p>
          </div>
        ) : (
          <>
            {/* Listed and the viewer is not the seller */}
            {isListed && !isSeller && (
              <>
                <button
                  onClick={handleBuy}
                  disabled={isProcessing}
                  className="flex items-center justify-center gap-2 bg-(--accent) text-(--bg-secondary) py-4 px-6 rounded-xl font-bold text-lg hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FaShoppingCart />
                  <span>{isProcessing ? "Processing..." : "Buy Now"}</span>
                </button>

                <button
                  onClick={() => {
                    setShowBidModal(true)
                    addToBatch(nftForBatch, "bid")
                  }}
                  className="flex items-center w-full justify-center gap-2 border-2 border-(--accent) text-(--accent) py-4 px-6 rounded-xl font-bold text-lg hover:bg-(--accent) hover:text-(--bg-secondary) transition-all"
                >
                  <FaGavel />
                  <span>Make Offer</span>
                </button>
              </>
            )}

            {/* The viewer is the seller */}
            {isListed && isSeller && (
              <button
                onClick={handleCancelListing}
                disabled={isProcessing}
                className="flex items-center justify-center gap-2 border-2  py-4 px-6 rounded-xl font-bold text-lg hover:bg-red-500 hover:text-white transition-all disabled:opacity-50"
              >
                <MdCancel />
                <span>{isProcessing ? "Cancelling..." : "Cancel Listing"}</span>
              </button>
            )}

            {/* The viewer owns the NFT but it is not listed */}
            {isOwner && !isListed && (
              <div className="card rounded-xl p-6 border border-(--text)/20">
                <div className="flex flex-col gap-3 items-center">
                  <FaTag className="text-3xl opacity-50" />
                  <p className="opacity-75 text-center">This NFT is not listed for sale</p>
                  <button
                    onClick={() => {
                      // Navigate to user page to list
                      router.push(`/user/${userAddress}`)
                    }}
                    className="flex items-center w-full justify-center gap-2 bg-(--accent) text-(--bg-secondary) py-2 px-6 rounded-xl font-bold hover:opacity-90"
                  >
                    <MdLocalOffer />
                    <span>List for Sale</span>
                  </button>
                </div>
              </div>
            )}

            {/* The viewer does not own the NFT and it is not listed */}
            {!isOwner && !isListed && (
              <div className="card rounded-xl p-6 border border-(--text)/20">
                <div className="flex flex-col gap-3 items-center">
                  <FaTag className="text-3xl opacity-50" />
                  <p className="opacity-75 text-center">This NFT is not listed for sale</p>
                  <button
                    onClick={() => {
                      setShowBidModal(true)
                      addToBatch(nftForBatch, "bid")
                    }}
                    className="flex items-center w-full justify-center gap-2 border-2 border-(--accent) text-(--accent) py-2 px-6 rounded-xl font-bold hover:bg-(--accent) hover:text-(--bg-secondary)"
                  >
                    <FaGavel />
                    <span>Make Offer</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bid modal */}
      {showBidModal && (
        <BidCard
          items={bidBatch}
          collectionAddress={nft.collection_address}
          collectionName={nft.collection?.name}
          onClose={() => {
            setShowBidModal(false)
            clearBatch("bid")
          }}
          onSuccess={() => {
            setShowBidModal(false)
            clearBatch("bid")
          }}
          onRemoveItem={() => removeFromBatch(nftForBatch, "bid")}
        />
      )}
    </div>
  )
}
