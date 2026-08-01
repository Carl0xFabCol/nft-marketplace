"use client"

import { useState } from "react"
import { useAccount } from "wagmi"
import { useRouter } from "next/navigation"
import { FaEthereum, FaShoppingCart, FaGavel, FaTag, FaTimes } from "react-icons/fa"
import { MdLocalOffer, MdCancel } from "react-icons/md"
import { useBuy } from "@/hooks/useBuyActions"
import { useCancelList } from "@/hooks/useListingActions"
import { useBidToken, useBidTokenBatch } from "@/hooks/useBidActions"
import { useTx } from "@/app/context/TxContext"
import { BidCard } from "../collections/collection/BidCard"
import { useBatchOperations } from "@/hooks/useBatchOperations"
import { NFTDetail, UserNFT } from "@/types/user.types"

interface NFTActionsProps {
  nft: NFTDetail
}

export function NFTActions({ nft }: NFTActionsProps) {
  const router = useRouter()
  const { address: userAddress } = useAccount()
  const [showBidModal, setShowBidModal] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const { removeFromBatch, clearBatch, addToBatch, isInBatch, bidBatch } = useBatchOperations()
  const { buy } = useBuy()
  const { cancelList } = useCancelList()
  const { bidToken } = useBidToken()
  const { publicClient } = useBidTokenBatch()
  const { addTx, updateTx, removeTx } = useTx()

  const isOwner = userAddress?.toLowerCase() === nft.owner_wallet.toLowerCase()
  const isListed = Boolean(nft.listing?.is_active)
  const isSeller = userAddress?.toLowerCase() === nft.listing?.seller_wallet?.toLowerCase()
  // The bid batch stores tokens as UserNFT; NFTDetail is a superset.
  const nftForBatch = nft as unknown as UserNFT

  // Handler for buying the NFT
  const handleBuy = async () => {
    if (!nft.listing || !userAddress) return

    setIsProcessing(true)
    let hash: any

    try {
      const price = BigInt(nft.listing.price)

      hash = await buy(nft.collection_address, BigInt(nft.token_id), price)

      addTx({
        hash,
        status: "loading",
        label: "Buying NFT...",
      })

      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash })
        updateTx(hash, {
          status: "success",
          label: "NFT purchased successfully!",
        })
        removeTx(hash)

        // Refetch the server component data in place (no full reload).
        router.refresh()
      }
    } catch (error) {
      console.error("Buy error:", error)
      if (hash) {
        updateTx(hash, { status: "error", label: "Purchase failed!" })
        removeTx(hash)
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const formatDate = (timestamp: any) => {
    const date = new Date(timestamp)
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
    let hash: any

    try {
      hash = await cancelList(nft.collection_address, Number(nft.token_id))

      addTx({
        hash,
        status: "loading",
        label: "Cancelling listing...",
      })

      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash })
        updateTx(hash, {
          status: "success",
          label: "Listing cancelled!",
        })
        removeTx(hash)

        router.refresh()
      }
    } catch (error) {
      console.error("Cancel listing error:", error)
      if (hash) {
        updateTx(hash, { status: "error", label: "Cancellation failed!" })
        removeTx(hash)
      }
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Precio actual */}
      {isListed && (
        <div className="bg-(--bg) rounded-xl p-6 border border-(--text)/20">
          <div className="flex flex-col gap-2">
            <span className="text-sm opacity-75">Current Price</span>
            <div className="flex items-center gap-2">
              <FaEthereum className="text-3xl" />
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

      {/* Botones de acción */}
      <div className="flex flex-col gap-2">
        {!userAddress ? (
          <div className="card rounded-xl p-4 text-center opacity-75">
            <p>Connect your wallet to interact with this NFT</p>
          </div>
        ) : (
          <>
            {/* Si el NFT está listado y NO eres el owner */}
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

            {/* Si eres el seller */}
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

            {/* Si eres el owner pero NO está listado */}
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

            {/* Si NO eres owner y NO está listado */}
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

      {/* Modal de hacer oferta */}
      {/* {showBidModal && (
        <div
          onClick={(e: any) => {
            if (e.target.id === "bid-modal-backdrop") {
              setShowBidModal(false)
            }
          }}
          id="bid-modal-backdrop"
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div className="card rounded-2xl border border-(--text)/20 max-w-md w-full">
            <div className="flex  justify-between items-center p-4">
              <div className="flex  gap-3 items-center">
                <FaGavel className="text-3xl" />
                <span className="text-2xl font-bold ">Bid token</span>
              </div>
              <button onClick={() => setShowBidModal(false)} className="bg-transparent! text-(--text)!">
                <FaTimes />
              </button>
            </div>

            <div className="flex flex-col gap-4 px-4">
              <div>
                <label className="text-sm opacity-75 mb-2 block">Offer price (ETH)</label>
                <div className="flex items-center gap-2 rounded-xl p-3 bg-(--bg)">
                  <FaEthereum className="text-2xl opacity-50" />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={bidAmount}
                    onChange={(e) => {
                      if (/^\d*\.?\d*$/.test(e.target.value)) {
                        setBidAmount(e.target.value)
                      }
                    }}
                    className="flex-1 bg-transparent! text-lg"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="flex gap-2 pb-4">
                <button
                  onClick={() => {
                    setShowBidModal(false)
                    setBidAmount("")
                  }}
                  className="flex-1 py-3 rounded border border-(--text)/20 hover:bg-(--text)/5"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMakeOffer}
                  disabled={!bidAmount || isProcessing}
                  className="flex-1 py-3 rounded bg-(--accent) text-(--bg-secondary) font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing ? "Processing..." : "Make Offer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )} */}
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
