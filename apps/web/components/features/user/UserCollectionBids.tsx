"use client"

import { useCancelCollectionBid } from "@/hooks/useBidActions"
import { Collection, UserCollectionBid } from "@/types/user.types"
import Link from "next/link"
import { useMemo, useState } from "react"
import { FaInbox } from "react-icons/fa"
import { HypeIcon } from "@/components/ui/HypeIcon"
import { useTx } from "@/app/context/TxContext"
import { waitForTxConfirmation } from "@/lib/tx"
import { usePublicClient } from "wagmi"
import { Address } from "viem"
import { UseBatchOperationsReturn } from "@/hooks/useBatchOperations"
import { useRealtimeTable } from "@/hooks/useRealtimeTable"
import { toUserCollectionBid, upsertCollectionBid, deactivateCollectionBid } from "@/lib/bidMerge"

interface UserCollectionBidsProps {
  collectionBids: UserCollectionBid[]
  collections: Collection[]
  batchOps: UseBatchOperationsReturn
  /** Page owner — used for the realtime subscription filter. */
  userAddress: Address
}

export default function UserCollectionBids({ collectionBids, collections, batchOps, userAddress }: UserCollectionBidsProps) {
  const [bids, setBids] = useState<UserCollectionBid[]>(collectionBids)
  const publicClient = usePublicClient()
  const { cancelCollectionBidBatch, addToBatch, removeFromBatch, isInBatch } = batchOps
  const { cancelCollectionBid } = useCancelCollectionBid()
  const { addTx, removeTx, updateTx } = useTx()

  // Sync when the server re-delivers a fresh list (e.g. router.refresh()).
  const [prevCollectionBids, setPrevCollectionBids] = useState(collectionBids)
  if (collectionBids !== prevCollectionBids) {
    setPrevCollectionBids(collectionBids)
    setBids(collectionBids)
  }

  // Live bid updates: new/updated/cancelled rows from the indexer arrive here
  // without a reload, so the "my bids" view reflects the DB as it changes.
  useRealtimeTable<UserCollectionBid>({
    table: "collection_bids",
    filter: `bidder_wallet=eq.${userAddress.toLowerCase()}`,
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

  const { sorted, totalSize } = useMemo(
    () => ({
      sorted: [...bids].sort((a, b) => Number(a.price) - Number(b.price)),
      totalSize: bids.reduce((sum, bid) => sum + Number(bid.price), 0),
    }),
    [bids],
  )

  const handleCancelCollectionBids = async () => {
    const collectionAddresses = cancelCollectionBidBatch.map((i) => i.collection_address).filter((address): address is Address => Boolean(address))
    if (!collectionAddresses.length) return

    try {
      // The contract has no batch cancel for collection bids — send and
      // confirm one transaction per collection so every tx is tracked.
      for (let i = 0; i < collectionAddresses.length; i++) {
        const hash = await cancelCollectionBid(collectionAddresses[i])
        addTx({
          hash,
          status: "loading",
          label: `Cancelling bid ${i + 1}/${collectionAddresses.length}...`,
        })

        try {
          await waitForTxConfirmation(publicClient, hash)
          updateTx(hash, {
            status: "success",
            label: `Cancelled ${i + 1}/${collectionAddresses.length} bids!`,
          })
          setTimeout(() => removeTx(hash), 5000)
        } catch (error) {
          updateTx(hash, { status: "error", label: "Cancellation failed!" })
          setTimeout(() => removeTx(hash), 6000)
          throw error
        }
      }
    } catch (error) {
      console.error("Cancel col bid error:", error)
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
          {sorted.map((c) => {
            const percent = ((Number(c.quantity) / totalSize) * 100).toFixed(0)
            const collection = collections.find((col) => col.contract_address == c.collection_address)
            const name = collection ? collection.name : "-"
            const col_address = collection ? collection.contract_address : "-"
            return (
              <div key={c.id} className=" relative flex  ">
                <div className=" flex-1 py-2 pr-2   relative z-10">
                  <Link className="flex gap-2 items-center hover:opacity-75 w-fit" href={`/collection/${col_address}`}>
                    <span className=" ">{name}</span>
                    <span className=" opacity-75">{col_address.slice(0, 5)}</span>
                  </Link>
                </div>
                <div className="p-2 flex-1 pr-5 pl-5 relative z-10  ">
                  <div className="flex gap-2 items-center">
                    <span>{Number(c.price) / 1e18}</span>
                    <HypeIcon />
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
          {!bids.length && (
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
