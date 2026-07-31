"use client"

import { useCancelCollectionBid } from "@/hooks/useBidActions"
import { Collection, UserCollectionBid } from "@/types/user.types"
import Link from "next/link"
import { useEffect, useState } from "react"
import { FaEthereum, FaInbox } from "react-icons/fa"
import { useTx } from "@/app/context/TxContext"
import { usePublicClient } from "wagmi"
import { UseBatchOperationsReturn } from "@/hooks/useBatchOperations"

interface UserCollectionBidsProps {
  collectionBids: UserCollectionBid[]
  collections: Collection[]
  batchOps: UseBatchOperationsReturn
}

export default function UserCollectionBids({ collectionBids, collections, batchOps }: UserCollectionBidsProps) {
  const [totalSize, setTotalSize] = useState<number>(0)
  const [sorted, setSorted] = useState<any[]>([])
  const publicClient = usePublicClient()
  const { cancelCollectionBidBatch, addToBatch, removeFromBatch, isInBatch } = batchOps
  const { cancelCollectionBid } = useCancelCollectionBid()
  const { addTx, removeTx, updateTx } = useTx()

  useEffect(() => {
    if (collectionBids) {
      setSorted([...collectionBids].sort((a, b) => Number(a.price) - Number(b.price)))
      setTotalSize(
        collectionBids.reduce((sum, bid) => {
          return (sum += Number(bid.price))
        }, 0),
      )
    }
  }, [collectionBids])

  const handleCancelCollectionBids = async () => {
    const collectionAddresses = cancelCollectionBidBatch.map((i: any) => i.collection_address)
    if (!collectionAddresses.length) return

    let hash: any
    try {
      hash = await cancelCollectionBid(collectionAddresses[0])
      addTx({
        hash,
        status: "loading",
        label: `Cancelling ${collectionAddresses.length} bids...`,
      })

      // The contract has no batch cancel for collection bids — cancel each
      // remaining collection sequentially (one tx per collection).
      for (let i = 1; i < collectionAddresses.length; i++) {
        await cancelCollectionBid(collectionAddresses[i])
      }

      if (hash && publicClient) {
        await publicClient.waitForTransactionReceipt({ hash })
        updateTx(hash, {
          status: "success",
          label: `Cancelled ${collectionAddresses.length} bids!`,
        })

        removeTx(hash)
      }
    } catch (error) {
      console.error("Cancel col bid error:", error)
      if (hash) {
        updateTx(hash, { status: "error", label: "Cancellation failed!" })
        removeTx(hash)
      }
    }
  }

  return (
    <div className="w-full flex  ">
      <div className="w-full border-collapse text-left  p-2  ">
        <div>
          <div className="border-b border-(--text)/20 items-center py-2 flex relative">
            <span className="flex-1   py-2">Collection</span>

            <div className="flex-1 pl-6 py-2 border-l border-(--text-secondary)/30 flex gap-3 items-center">
              <span>Price</span>
            </div>
            <span className="flex-1 border-l border-(--text-secondary)/30 pl-6  p-2">Amount</span>
            <button
              onClick={handleCancelCollectionBids}
              disabled={!cancelCollectionBidBatch.length}
              className={
                "py-1 absolute px-4 right-0 rounded gap-2 flex items-center border! border-(--accent)! " +
                (!cancelCollectionBidBatch.length ? "  opacity-50! hover:opacity-50! hover:cursor-default! " : "")
              }
            >
              <span>Cancel</span>
              <span>{cancelCollectionBidBatch.length}</span>
              <span>bids</span>
            </button>
          </div>
        </div>

        <div>
          {sorted.map((c: any, index: number) => {
            const percent = ((Number(c.quantity) / totalSize) * 100).toFixed(0)
            const collection = collections.find((col: Collection) => col.contract_address == c.collection_address)
            const name = collection ? collection.name : "-"
            const col_address = collection ? collection.contract_address : "-"
            return (
              <div key={index} className=" relative flex  ">
                <div className=" flex-1 py-2 pr-2   relative z-10">
                  <Link className="flex gap-2 items-center hover:opacity-75 w-fit" href={`/collection/${col_address}`}>
                    <span className=" ">{name}</span>
                    <span className=" opacity-75">{col_address.slice(0, 5)}</span>
                  </Link>
                </div>
                <div className="p-2 flex-1 pr-5 pl-5 relative z-10  ">
                  <div className="flex gap-2 items-center">
                    <span>{Number(c.price) / 1e18}</span>
                    <FaEthereum />
                  </div>
                </div>
                <span className="p-2 flex-1 relative z-10  ">{c.quantity}</span>
                <button
                  className="py-2 flex absolute right-0 z-10 bg-transparent! text-(--text)!"
                  onClick={() => {
                    if (isInBatch(c, "cancelCollectionBid")) {
                      removeFromBatch(c, "cancelCollectionBid")
                    } else {
                      addToBatch(c, "cancelCollectionBid")
                    }
                  }}
                >
                  {isInBatch(c, "cancelCollectionBid") ? "- Cancel" : "+ Cancel"}
                </button>
                <div className="absolute  left-0 top-0 h-full bg-[#38b7384f] z-5 " style={{ width: `${percent}%` }} />
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
