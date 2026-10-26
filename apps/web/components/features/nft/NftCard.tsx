import { useTx } from "@/app/context/TxContext"
import { useAcceptCollectionBid, useAcceptTokenBid } from "@/hooks/useBidActions"
import { useEnsureApproval } from "@/hooks/useEnsureApproval"
import { EnrichedUserNFT } from "@/types/user.types"
import { UseBatchOperationsReturn } from "@/hooks/useBatchOperations"
import { motion } from "framer-motion"
import Link from "next/link"
import { useState } from "react"
import { HypeIcon } from "@/components/ui/HypeIcon"
import { useConnection, usePublicClient } from "wagmi"
import { Address } from "viem"
import { IpfsImage } from "@/components/features/nft/IpfsImage"
import { waitForTxConfirmation } from "@/lib/tx"

type NftCardToken = EnrichedUserNFT & {
  price?: number
  seller_wallet?: string | null
}

interface NFTCardProps {
  token: NftCardToken
  isUserPage?: boolean
  index?: number
  batchOps: UseBatchOperationsReturn
  approvalMap?: Map<string, boolean> | null
  onBidAccepted?: (token: NftCardToken) => void
}

export function NFTCard({ token, isUserPage = false, index, batchOps, approvalMap = null, onBidAccepted }: NFTCardProps) {
  const [bidHovered, setBidHovered] = useState<boolean>(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const { addToBatch, isInBatch, removeFromBatch } = batchOps
  const { address } = useConnection()
  const publicClient = usePublicClient()
  const { acceptTokenBid } = useAcceptTokenBid()
  const { acceptCollectionBid } = useAcceptCollectionBid()
  const { ensureApproval } = useEnsureApproval()
  const { addTx, removeTx, updateTx } = useTx()
  const handleNFTClick = (nft: NftCardToken, e: React.MouseEvent) => {
    if (isUserPage) {
      const isApproved = approvalMap?.get(nft.collection_address.toLowerCase())

      if (!isInBatch(nft, "list") && !isInBatch(nft, "approve") && !isInBatch(nft, "delist")) {
        if (isApproved) {
          if (Boolean(nft.active_listing)) {
            addToBatch(nft, "delist")
          } else {
            addToBatch(nft, "list")
          }
        } else {
          addToBatch(nft, "approve")
        }
      } else {
        if (isInBatch(nft, "approve")) {
          removeFromBatch(nft, "approve")
        } else if (isInBatch(nft, "list")) {
          removeFromBatch(nft, "list")
        } else if (isInBatch(nft, "delist")) {
          removeFromBatch(nft, "delist")
        }
      }

      return
    }

    if (e.target instanceof HTMLElement && e.target.id === "col_link") {
      return
    }

    const isListed = Boolean(nft.price)

    if (isListed) {
      if (batchOps.isInBatch(nft, "buy")) {
        batchOps.removeFromBatch(nft, "buy")
      } else {
        batchOps.addToBatch(nft, "buy")
      }
    }

    if (batchOps.isInBatch(nft, "bid")) {
      batchOps.removeFromBatch(nft, "bid")
    } else {
      batchOps.addToBatch(nft, "bid")
    }
  }

  const getBorderClass = (nft: NftCardToken) => {
    if (isUserPage) {
      const isApproved = approvalMap?.get(nft.collection_address.toLowerCase())

      if (isInBatch(nft, "list")) return "border-(--accent)!"
      if (isInBatch(nft, "approve")) return "border-white!"
      if (isInBatch(nft, "delist")) return "border-[#c19137]!"

      if (!isApproved) return "peer-hover:border-white!"
      if (Boolean(nft.active_listing)) return "peer-hover:border-[#c19137]!"
      return "peer-hover:border-(--accent)!"
    } else {
      if (batchOps.isInBatch(nft, "buy")) return "border-(--accent)!"
      if (batchOps.isInBatch(nft, "bid")) return "border-[orange]!"
      return "border-(--accent)/30"
    }
  }

  const getBadgeLabel = (nft: EnrichedUserNFT) => {
    if (isInBatch(nft, "list")) return "LIST"
    if (isInBatch(nft, "delist")) return "DELIST"
    if (isInBatch(nft, "approve")) return "APPROVE"
    if (isInBatch(nft, "buy") && isInBatch(nft, "bid")) return "BUY / BID"
    if (isInBatch(nft, "buy")) return "BUY"
    if (isInBatch(nft, "bid")) return "BID"
    return null
  }

  const getBadgeClass = (nft: EnrichedUserNFT) => {
    if (isInBatch(nft, "list")) return "border-(--accent)! text-(--accent)!"
    if (isInBatch(nft, "delist")) return "border-[#c19137]! text-[#c19137]!"
    if (isInBatch(nft, "approve")) return "border-white text-white"
    if (isInBatch(nft, "buy")) return "border-(--accent)! text-(--accent)!"
    if (isInBatch(nft, "bid")) return "border-[#c19137]! text-[#c19137]!"
    return ""
  }

  const handleHoverBid = () => {
    if (address?.toLowerCase() == token.owner_wallet && !!token.topBid) {
      setBidHovered(true)
    }
  }

  const handleAcceptBid = async () => {
    if (!token.topBid || !address) return

    const bid = token.topBid
    const collection = token.collection_address as Address
    let hash: `0x${string}` | undefined

    try {
      await ensureApproval(collection, address)

      hash =
        bid.kind === "collection"
          ? await acceptCollectionBid(collection, bid.bidder_wallet, [BigInt(token.token_id)])
          : await acceptTokenBid(collection, Number(token.token_id), bid.bidder_wallet)

      addTx({ hash, label: "Accepting bid...", status: "loading" })

      await waitForTxConfirmation(publicClient, hash)

      updateTx(hash, { label: "Bid accepted successfully!", status: "success" })
      setTimeout(() => removeTx(hash!), 5000)

      removeFromBatch(token, "list")
      removeFromBatch(token, "delist")
      onBidAccepted?.(token)
    } catch (e) {
      console.error("Error accepting bid:", e)
      if (hash) {
        updateTx(hash, { label: "Transaction failed", status: "error" })
        setTimeout(() => removeTx(hash!), 6000)
      }
    }
  }

  return (
    <motion.div
      key={token.token_id + token.collection_address}
      initial={{ filter: "blur(5px)", opacity: 0.3 }}
      animate={{ filter: "blur(0px)", opacity: 1 }}
      transition={{ duration: 0.2, delay: (index ?? 0) * 0.03 }}
      className={`
                         relative border-2 
                        bg-(--accent)/10 rounded-lg
                         transition-all flex flex-col justify-between 
                        ${hovered === token.token_id + token.collection_address ? "border-(--accent)!" : "border-(--accent)/30"}
                        ${getBorderClass(token)}
                      `}
    >
      <div className="flex flex-col h-full overflow-hidden rounded">
        <div
          id="nft-img"
          className="relative w-full aspect-square cursor-pointer overflow-hidden"
          onMouseEnter={() => setHovered(token.token_id + token.collection_address)}
          onMouseLeave={() => setHovered(null)}
          onClick={(e) => handleNFTClick(token, e)}
        >
          {getBadgeLabel(token) && (
            <div
              className={`
        absolute left-3 top-3 z-10
        bg-(--bg-secondary) rounded text-xs border px-2 py-1
        font-bold shadow-lg
        ${getBadgeClass(token)}
      `}
            >
              {getBadgeLabel(token)}
            </div>
          )}

          <IpfsImage src={token.image_url} alt={token.metadata?.name || token.name || "NFT"} className="w-full h-full object-cover transition-transform duration-300" />
        </div>
        <div className="transition-opacity flex flex-col w-full flex-1 card">
          <div className="flex flex-col     w-full justify-between lg:text-sm text-xs">
            <div className="flex flex-col gap-1 items-start p-2 border-b border-(--text)/20">
              <Link href={`/collection/${token.collection_address}/${token.token_id}`} onClick={(e) => e.stopPropagation()} className="flex gap-2 opacity-72 hover:opacity-50!">
                <span id="col_link" className="  ">
                  {token.name || token.metadata?.name || "-"}
                </span>
              </Link>
              <div className="flex gap-2  text-xs lg:text-sm items-center ">
                <span className="font-bold  ">{token.price ? Number(token.price.toString()) / 1e18 : token.active_listing ? Number(token.active_listing.price.toString()) / 1e18 : "-"}</span>
                <HypeIcon />
                {isUserPage && token.active_listing?.status === "pending" && (
                  <span className="text-[10px] uppercase tracking-wide opacity-70 px-1.5 py-0.5 rounded border border-(--accent)/40 text-(--accent)">Pending…</span>
                )}
              </div>
            </div>

            <div className="flex flex-col p-2 text-xs relative">
              <div className="flex flex-row gap-2" onMouseEnter={handleHoverBid} onMouseLeave={() => setBidHovered(false)}>
                <span>Top bid:</span>
                <span className="flex gap-2 items-center">
                  {token.topBid && Number(token.topBid.price) / 1e18}
                  {token.topBid && <HypeIcon />}
                  {!token.topBid && "-"}
                </span>
                {bidHovered && (
                  <div className="w-full p-1 absolute top-0 left-0  flex items-center card">
                    <button onClick={handleAcceptBid} className="w-full rounded p-1 ">
                      Accept bid
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
