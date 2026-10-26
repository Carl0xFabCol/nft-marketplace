"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { FaInbox } from "react-icons/fa"
import { HypeIcon } from "@/components/ui/HypeIcon"
import { useAccount } from "wagmi"
import { Address } from "viem"
import { UserCollectionBid } from "@/types/user.types"
import { useRealtimeTable } from "@/hooks/useRealtimeTable"
import { toUserCollectionBid, upsertCollectionBid, deactivateCollectionBid } from "@/lib/bidMerge"

interface CollectionBidsProps {
  collectionBids: UserCollectionBid[]
  allBids?: boolean
  /** Used for the realtime subscription filter. */
  collectionAddress: Address
}

export default function CollectionBids({ collectionBids, allBids = true, collectionAddress }: CollectionBidsProps) {
  const [bids, setBids] = useState<UserCollectionBid[]>(collectionBids)
  const { address } = useAccount()

  // Sync when the server re-delivers fresh bids (e.g. router.refresh()).
  const [prevCollectionBids, setPrevCollectionBids] = useState(collectionBids)
  if (collectionBids !== prevCollectionBids) {
    setPrevCollectionBids(collectionBids)
    setBids(collectionBids)
  }

  // Live bid updates: a new collection bid shows up instantly; a cancelled one
  // disappears without a reload.
  useRealtimeTable<UserCollectionBid>({
    table: "collection_bids",
    filter: `collection_address=eq.${collectionAddress.toLowerCase()}`,
    onChange: (change) => {
      if (change.eventType === "DELETE") {
        const old = change.old
        if (old) setBids((prev) => deactivateCollectionBid(prev, toUserCollectionBid(old)))
        return
      }
      const row = change.new
      if (!row) return
      const bid = toUserCollectionBid(row)
      setBids((prev) => (bid.is_active === false ? deactivateCollectionBid(prev, bid) : upsertCollectionBid(prev, bid)))
    },
  })

  const { totalSize, sorted } = useMemo(() => {
    const visibleBids = allBids ? bids : bids.filter((bid) => String(bid.bidder_wallet).toLowerCase() === String(address).toLowerCase())
    return {
      totalSize: visibleBids.reduce((size, bid) => size + Number(bid.quantity), 0),
      sorted: [...visibleBids].sort((a, b) => Number(b.price) - Number(a.price)),
    }
  }, [bids, allBids, address])

  return (
    <div className="w-full flex pb-4 ">
      <div className="w-full border-collapse text-left  p-2  ">
        <div>
          <div className=" items-center  flex ">
            <div className="flex-1 p-2 flex gap-3 items-center">
              <span>Price</span>
              <div className="flex gap-2">
                <span>(</span>
                <HypeIcon />
                <span>)</span>
              </div>
            </div>
            <span className="flex-1  pl-6 p-2">Amount</span>
            <span className="flex-1  px-6 p-2">Bidder</span>
          </div>
        </div>

        <div className="rounded overflow-hidden">
          {sorted.map((c) => {
            const percent = ((Number(c.quantity) / totalSize) * 100).toFixed(0)

            return (
              <div key={c.id} className=" relative flex  ">
                <span className="p-2 flex-1  relative z-3 ">{Number(c.price) / 1e18}</span>
                <span className="p-2 flex-1 relative z-3">{c.quantity}</span>
                <Link href={`/user/${c.bidder_wallet}`} className="p-2 flex-1 relative z-3 hover:opacity-50">
                  {c.bidder_wallet.slice(-6)}
                </Link>
                <div className="absolute  left-0 top-0 h-full bg-[#50ff5017] z-2 " style={{ width: `${percent}%` }} />
              </div>
            )
          })}
          {!sorted.length && (
            <div className=" flex flex-col items-center justify-center gap-2 p-4">
              <FaInbox className="text-3xl" />
              <p>No collection bids found </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
