"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { FaEthereum, FaInbox } from "react-icons/fa"
import { useAccount } from "wagmi"
import { UserCollectionBid } from "@/types/user.types"

interface CollectionBidsProps {
  collectionBids: UserCollectionBid[]
  allBids?: boolean
}

export default function CollectionBids({ collectionBids, allBids = true }: CollectionBidsProps) {
  const [totalSize, setTotalSize] = useState<number>(0)
  const [sorted, setSorted] = useState<UserCollectionBid[]>([])
  const { address } = useAccount()
  useEffect(() => {
    if (!collectionBids) return
    const _collectionBids = allBids ? collectionBids : collectionBids.filter((bid) => String(bid.bidder_wallet).toLowerCase() === String(address).toLowerCase())
    setTotalSize(
      _collectionBids.reduce((size, bid) => {
        return size + Number(bid.quantity)
      }, 0),
    )
    setSorted([..._collectionBids].sort((a, b) => Number(b.price) - Number(a.price)))
  }, [collectionBids, allBids, address])

  return (
    <div className="w-full flex pb-4 ">
      <div className="w-full border-collapse text-left  p-2  ">
        <div>
          <div className=" items-center  flex ">
            <div className="flex-1 p-2 flex gap-3 items-center">
              <span>Price</span>
              <div className="flex gap-2">
                <span>(</span>
                <FaEthereum />
                <span>)</span>
              </div>
            </div>
            <span className="flex-1  pl-6 p-2">Amount</span>
            <span className="flex-1  px-6 p-2">Bidder</span>
          </div>
        </div>

        <div className="rounded overflow-hidden">
          {sorted.map((c: any, index: number) => {
            const percent = ((Number(c.quantity) / totalSize) * 100).toFixed(0)

            return (
              <div key={index} className=" relative flex  ">
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
