"use client"

import { useState, useEffect } from "react"
import { useTx } from "@/app/context/TxContext"
import { useAcceptTokenBid } from "@/hooks/useBidActions"
import { useEnsureApproval } from "@/hooks/useEnsureApproval"
import Link from "next/link"
import { FaEthereum, FaExternalLinkAlt, FaGavel } from "react-icons/fa"
import { useAccount, usePublicClient } from "wagmi"
import { Address } from "viem"
import { UserTokenBid } from "@/types/user.types"
import { useRealtimeTable } from "@/hooks/useRealtimeTable"
import { toUserTokenBid, upsertTokenBid, deactivateTokenBid } from "@/lib/bidMerge"

interface NFTBidsProps {
  bids: UserTokenBid[]
  owner?: boolean
  /** Used for the realtime subscription filter. */
  collectionAddress: Address
  tokenId: string
}

export default function NFTBids({ bids, owner = false, collectionAddress, tokenId }: NFTBidsProps) {
  const [bidList, setBidList] = useState<UserTokenBid[]>(bids)
  const { acceptTokenBid } = useAcceptTokenBid()
  const { ensureApproval } = useEnsureApproval()
  const { addTx, updateTx, removeTx } = useTx()
  const publicClient = usePublicClient()
  const { address } = useAccount()

  // Sync when the server re-delivers fresh bids (e.g. router.refresh()).
  useEffect(() => {
    setBidList(bids)
  }, [bids])

  // Live bid updates: a new offer on this token appears instantly; a
  // cancelled/accepted bid disappears without a reload.
  useRealtimeTable<UserTokenBid>({
    table: "token_bids",
    filter: `and=(collection_address.eq.${collectionAddress.toLowerCase()},token_id.eq.${tokenId})`,
    onChange: (change) => {
      if (change.eventType === "DELETE") {
        const old = change.old
        if (old) setBidList((prev) => deactivateTokenBid(prev, toUserTokenBid(old)))
        return
      }
      const row = change.new
      if (!row) return
      const bid = toUserTokenBid(row)
      setBidList((prev) => (bid.is_active === false ? deactivateTokenBid(prev, bid) : upsertTokenBid(prev, bid)))
    },
  })

  const handleAcceptBid = async (bid: UserTokenBid) => {
    if (!address || !bid.collection_address || !bid.token_id || !bid.bidder_wallet) return

    const collection = bid.collection_address as Address
    let hash: `0x${string}` | undefined

    try {
      await ensureApproval(collection, address)

      hash = await acceptTokenBid(collection, Number(bid.token_id), bid.bidder_wallet as Address)
      addTx({ hash, label: "Accepting token bid", status: "loading" })

      const receipt = await publicClient?.waitForTransactionReceipt({ hash })
      if (receipt && receipt.status !== "success") {
        throw new Error("Transaction reverted")
      }

      updateTx(hash, { status: "success" })
      removeTx(hash)
    } catch (e) {
      console.error("Error accepting token bid: " + e)
      if (hash) {
        updateTx(hash, { status: "error" })
        removeTx(hash)
      }
    }
  }

  if (bidList.length > 0)
    return (
      <div className="flex flex-col gap-2">
        {/* Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-2 text-sm font-bold opacity-75 border-b border-(--text)/20">
          <div className="col-span-3">Price</div>
          <div className="col-span-3">Bidder</div>
          <div className="col-span-3"></div>
        </div>

        {/* Activity items */}
        <div className="flex flex-col max-h-96 overflow-y-auto">
          {bidList.map((bid: UserTokenBid, index: number) => {
            return (
              <div key={bid.id ?? index} className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-(--accent)/5 border-b border-(--text)/10 transition-colors">
                {/* Event type */}
                <div className="col-span-3 flex items-center gap-2">
                  <span className="font-semibold">{Number(bid.price) / 1e18}</span>
                  <FaEthereum className="text-sm" />
                </div>

                {/* From */}
                <div className="col-span-3 flex items-center">
                  <Link href={`/user/${bid.bidder_wallet}`} className="font-mono text-sm hover:text-(--accent) transition-colors" onClick={(e) => e.stopPropagation()}>
                    {bid.bidder_wallet?.slice(-7)}
                  </Link>
                </div>

                <div className="col-span-3">
                  {owner && (
                    <button
                      onClick={() => handleAcceptBid(bid)}
                      className="px-4 py-1 rounded bg-transparent! transition-all duration-200 text-(--accent)! hover:bg-(--accent)/50! hover:text-(--text)!  "
                    >
                      Accept bid
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )

  return (
    <div className="flex w-full py-12 opacity-50 justify-center items-center flex-col">
      <div className="flex flex-col justify-center items-center gap-2">
        <FaGavel className="text-3xl" />

        <span>No bids found</span>
      </div>
    </div>
  )
}
