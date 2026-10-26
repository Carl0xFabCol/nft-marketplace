"use client"

import { useMemo, useState } from "react"
import { FaInbox } from "react-icons/fa"
import { HypeIcon } from "@/components/ui/HypeIcon"
import { useTx } from "@/app/context/TxContext"
import { waitForTxConfirmation } from "@/lib/tx"
import { useAccount, usePublicClient } from "wagmi"
import { Address } from "viem"
import { Collection, UserTokenBid } from "@/types/user.types"
import Link from "next/link"
import { UseBatchOperationsReturn } from "@/hooks/useBatchOperations"
import { useCancelTokenBid, useCancelTokenBidBatch } from "@/hooks/useBidActions"
import { useRealtimeTable } from "@/hooks/useRealtimeTable"
import { toUserTokenBid, upsertTokenBid, deactivateTokenBid } from "@/lib/bidMerge"

interface UserTokenBidsProps {
  tokenBids: UserTokenBid[]
  selectedCollection: Address | ""
  collections: Collection[]
  batchOps: UseBatchOperationsReturn
  /** Page owner — used for the realtime subscription filter. */
  userAddress: Address
}

export default function UserTokenBids({ tokenBids, selectedCollection, batchOps, collections, userAddress }: UserTokenBidsProps) {
  const [bids, setBids] = useState(tokenBids)
  const { addTx, removeTx, updateTx } = useTx()
  const publicClient = usePublicClient()
  const { address } = useAccount()

  const { cancelTokenBidBatch, addToBatch, removeFromBatch, isInBatch, clearBatch } = batchOps
  const { cancelTokenBid } = useCancelTokenBid()
  const { cancelTokenBids } = useCancelTokenBidBatch()

  // Sync when the server re-delivers a fresh list (e.g. router.refresh()).
  const [prevTokenBids, setPrevTokenBids] = useState(tokenBids)
  if (tokenBids !== prevTokenBids) {
    setPrevTokenBids(tokenBids)
    setBids(tokenBids)
  }

  // Live bid updates: new/updated/cancelled rows from the indexer arrive here
  // without a reload, so the "my bids" view reflects the DB as it changes.
  useRealtimeTable<UserTokenBid>({
    table: "token_bids",
    filter: `bidder_wallet=eq.${userAddress.toLowerCase()}`,
    onChange: (change) => {
      if (change.eventType === "DELETE") {
        const old = change.old
        if (old) setBids((prev) => deactivateTokenBid(prev, toUserTokenBid(old)))
        return
      }
      const row = change.new
      if (!row) return
      const bid = toUserTokenBid(row)
      setBids((prev) => (bid.is_active === false ? deactivateTokenBid(prev, bid) : upsertTokenBid(prev, bid)))
    },
  })

  const sortedBids = useMemo(() => {
    if (!address) return []

    let visibleBids = bids.filter((bid) => String(bid.bidder_wallet).toLowerCase() === String(address).toLowerCase())
    if (selectedCollection) {
      visibleBids = visibleBids.filter((bid) => String(bid.collection_address).toLowerCase() === String(selectedCollection).toLowerCase())
    }
    return [...visibleBids].sort((a, b) => Number(b.price) - Number(a.price))
  }, [bids, address, selectedCollection])

  const handleCancelBids = async () => {
    if (!cancelTokenBidBatch.length) return
    let hash: `0x${string}` | undefined
    try {
      const bids = cancelTokenBidBatch.filter(
      (bid): bid is UserTokenBid & { collection_address: Address; token_id: string } => Boolean(bid.collection_address) && Boolean(bid.token_id),
    )
    if (!bids.length) return

    if (bids.length > 1) {
        hash = await cancelTokenBids(
          bids.map((b) => b.collection_address),
          bids.map((b) => BigInt(b.token_id)),
        )
        addTx({ hash, status: "loading", label: "Cancelling token bids" })
      } else {
        hash = await cancelTokenBid(bids[0].collection_address, Number(bids[0].token_id))
        addTx({ hash, status: "loading", label: "Cancelling token bids" })
      }
      await waitForTxConfirmation(publicClient, hash)
      updateTx(hash, { status: "success", label: "Cancelled!" })
      clearBatch("cancelTokenBid")
      setTimeout(() => removeTx(hash!), 5000)
    } catch {
      if (hash) {
        updateTx(hash, { status: "error", label: "Cancelling error!" })
        setTimeout(() => removeTx(hash!), 6000)
      }
    }
  }

  return (
    <div className="w-full flex">
      <div className="w-full flex flex-col border-collapse text-left  p-2  ">
        <div>
          <div className="border-b flex relative items-center border-(--text)/20  py-2">
            <div className="flex flex-1  p-2 gap-3 items-center">
              <span>Token</span>
            </div>
            <div className="flex flex-1  py-2 px-6 border-l border-(--text)/20 gap-3 items-center">
              <span>Price</span>
            </div>
            <button
              onClick={handleCancelBids}
              disabled={!cancelTokenBidBatch.length}
              className={
                "py-1 px-4 absolute right-0 rounded gap-2 flex items-center border! border-(--accent)! " + (!cancelTokenBidBatch.length ? "  opacity-50! hover:opacity-50! hover:cursor-default! " : "")
              }
            >
              <span>Cancel</span>
              <span>{cancelTokenBidBatch.length}</span>
              <span>bids</span>
            </button>
          </div>
        </div>

        <div>
          {!!sortedBids &&
            sortedBids.map((c) => {
              const col = collections.find((col) => col.contract_address.toLowerCase() == String(c.collection_address).toLowerCase())
              const colName = col ? col.name : "-"
              return (
                <div key={c.id} className="flex items-center  relative  ">
                  <div className="flex-1 gap-2 items-center">
                    <Link href={`/collection/${c.collection_address}`} target="_blank">
                      {colName} #{c.token_id}
                    </Link>
                  </div>
                  <span className="flex-1 py-2 pl-6 flex  relative z-10">
                    <div className="flex gap-2 items-center">
                      <span>{Number(c.price) / 1e18}</span>
                      <HypeIcon />
                    </div>
                  </span>
                  <div className="flex absolute z-10 right-0 justify-end">
                    <button
                      onClick={() => {
                        if (isInBatch(c, "cancelTokenBid")) {
                          removeFromBatch(c, "cancelTokenBid")
                        } else {
                          addToBatch(c, "cancelTokenBid")
                        }
                      }}
                      className="bg-transparent! text-(--text)!"
                    >
                      {isInBatch(c, "cancelTokenBid") ? "- Cancel" : "+ Cancel"}
                    </button>
                  </div>
                </div>
              )
            })}
          {!bids.length && (
            <div className=" flex flex-col items-center justify-center gap-2 p-4">
              <FaInbox className="text-3xl" />
              <p>No token bids found </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
