import { useTx } from "@/app/context/TxContext"
import { useAcceptTokenBid } from "@/hooks/Contract"
import { EnrichedUserNFT } from "@/types/user.types"
import { motion } from "framer-motion"
import Link from "next/link"
import { useState } from "react"
import { FaEthereum, FaUser } from "react-icons/fa"
import { useConnection, usePublicClient } from "wagmi"

export function NFTCard({ token, isUserPage = false, index, batchOps, approvalMap = null }: any) {
  const [bidHovered, setBidHovered] = useState<boolean>(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const { addToBatch, isInBatch, removeFromBatch } = batchOps

  const { address } = useConnection()
  const publicClient = usePublicClient()
  const { acceptTokenBid } = useAcceptTokenBid()
  const { addTx, removeTx, updateTx } = useTx()
  const handleNFTClick = (nft: any, e: React.MouseEvent) => {
    const target = e.target as HTMLElement

    if (isUserPage) {
      if (target.id != "nft-img") {
        return
      }

      const isApproved = approvalMap.get(nft.collection_address.toLowerCase())

      if (!isInBatch(nft, "list") && !isInBatch(nft, "approve") && !isInBatch(nft, "delist")) {
        if (isApproved) {
          if (nft.listed) {
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
    } else {
      if (target.id === "col_link") return

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
  }

  const getBorderClass = (nft: any) => {
    if (isUserPage) {
      const isApproved = approvalMap[nft.collection_address.toLowerCase()]

      if (isInBatch(nft, "list")) return "border-(--accent)!"
      if (isInBatch(nft, "approve")) return "border-white!"
      if (isInBatch(nft, "delist")) return "border-[#c19137]!"

      if (!isApproved) return "peer-hover:border-white!"
      if (nft.listed) return "peer-hover:border-[#c19137]!"
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

  const handleAcceptTokenBid = async (token_id: number, bidder: string, collection_address: string) => {
    let hash = ""
    try {
      const hash = await acceptTokenBid(collection_address as `0x${string}`, token_id, bidder as `0x${string}`)

      addTx({ hash, label: "Accepting bid...", status: "loading" })

      const txRes = await publicClient?.waitForTransactionReceipt({ hash })
      if (txRes && txRes?.status === "success") {
        updateTx(hash, { label: "Bid accepted successfully!", status: "success" })
      } else {
        throw new Error("Transaction reverted")
      }

      updateTx(hash, { label: "Bid accepted succesfuly!", status: "success" })
    } catch (e) {
      updateTx(hash, { label: "Transaction failed", status: "error" })
      removeTx(hash as `0x${string}`)
    }
  }

  return (
    <motion.div
      key={token.token_id + token.collection_address}
      initial={{ filter: "blur(5px)", opacity: 0.3 }}
      animate={{ filter: "blur(0px)", opacity: 1 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      onClick={(e) => handleNFTClick(token, e)}
      className={`
                         relative border-2 
                        bg-(--accent)/10 rounded-lg
                         transition-all flex flex-col justify-between 
                        ${hovered === token.token_id + token.collection_address ? "border-(--accent)!" : "border-(--accent)/30"}
                        ${getBorderClass(token)}
                      `}
    >
      <div className="flex rounded flex-col overflow-hidden justify-between h-full">
        <div id="nft-img" className="w-full  cursor-pointer" onMouseEnter={() => setHovered(token.token_id + token.collection_address)} onMouseLeave={() => setHovered(null)}>
          {getBadgeLabel(token) && (
            <div
              id="nft-img"
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
          {token.image_url && <img id="nft-img" src={token.image_url} alt="" />}
          {!token.image_url && <span>No image</span>}
        </div>

        <div className=" transition-opacity flex flex-col   w-full card">
          <div className="flex flex-col     w-full justify-between lg:text-sm text-xs">
            <div className="flex flex-col gap-1 items-start p-2 border-b border-(--text)/20">
              <Link id="col_link " href={`/collection/${token.collection_address}/${token.token_id}`} className="flex gap-2 opacity-72 hover:opacity-50!">
                <span id="col_link" className="  ">
                  {token.metadata.name || token.name || "-"}
                </span>
              </Link>
              <div className="flex gap-2  text-xs lg:text-sm items-center ">
                <span className="font-bold  ">{token.price ? Number(token.price.toString()) / 1e18 : token.active_listing ? Number(token.active_listing.price.toString()) / 1e18 : "-"}</span>
                <FaEthereum />
              </div>
            </div>

            <div className="flex flex-col p-2 text-xs relative">
              <div className="flex flex-row gap-2" onMouseEnter={handleHoverBid} onMouseLeave={() => setBidHovered(false)}>
                <span>Top bid:</span>
                <span className="flex gap-2 items-center">
                  {token.topBid && Number(token.topBid.price) / 1e18}
                  {token.topBid && <FaEthereum />}
                  {!token.topBid && "-"}
                </span>
                {bidHovered && (
                  <div className="w-full p-1 absolute top-0 left-0  flex items-center card">
                    <button onClick={() => handleAcceptTokenBid(token.token_id, token.topBid.bidder_wallet, token.collection_address)} className="w-full rounded p-1 ">
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
