"use client"

import { useEffect, useState } from "react"
import { FaEthereum, FaInbox } from "react-icons/fa"
import { useTx } from "@/app/context/TxContext"
import { useAccount, usePublicClient } from "wagmi"
import { Address } from "viem"
import { Collection, UserTokenBid } from "@/types/user.types"
import Link from "next/link"
import { UseBatchOperationsReturn } from "@/hooks/useBatchOperations"
import { useCancelTokenBid, useCancelTokenBidBatch } from "@/hooks/useBidActions"

interface UserTokenBidsProps {
  tokenBids: UserTokenBid[]
  selectedCollection: Address | ""
  collections: Collection[]
  batchOps: UseBatchOperationsReturn
}

export default function UserTokenBids({ tokenBids, selectedCollection, batchOps, collections }: UserTokenBidsProps) {
  const [sortedBids, setSortedBids] = useState(tokenBids)
  const { addTx, removeTx, updateTx } = useTx()
  const publicClient = usePublicClient()
  const { address } = useAccount()

  const { cancelTokenBidBatch, addToBatch, removeFromBatch, isInBatch, clearBatch } = batchOps
  const { cancelTokenBid } = useCancelTokenBid()
  const { cancelTokenBids } = useCancelTokenBidBatch()

  useEffect(() => {
    if (tokenBids && address) {
      let _tokenBids = tokenBids.filter((b) => String(b.bidder_wallet).toLowerCase() === String(address).toLowerCase())
      if (selectedCollection) {
        _tokenBids = _tokenBids.filter((b) => String(b.collection_address).toLowerCase() === String(selectedCollection).toLowerCase())
      }
      setSortedBids([..._tokenBids].sort((a, b) => Number(b.price) - Number(a.price)))
    }
  }, [tokenBids, address, selectedCollection])

  const handleCancelBids = async () => {
    if (!cancelTokenBidBatch.length) return
    let hash: any
    try {
      if (cancelTokenBidBatch.length > 1) {
        hash = await cancelTokenBids(
          cancelTokenBidBatch.map((b) => b.collection_address),
          cancelTokenBidBatch.map((b) => BigInt(b.token_id)),
        )
        addTx({ hash, status: "loading", label: "Cancelling token bids" })
      } else {
        hash = await cancelTokenBid(cancelTokenBidBatch[0].collection_address, Number(cancelTokenBidBatch[0].token_id))
        addTx({ hash, status: "loading", label: "Cancelling token bids" })
      }
      await publicClient?.waitForTransactionReceipt({ hash })
      updateTx(hash, { status: "success", label: "Cancelled!" })
      clearBatch("cancelTokenBid")
      removeTx(hash)
    } catch (e) {
      updateTx(hash, { status: "error", label: "Cancelling error!" })
      removeTx(hash)
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
            sortedBids.map((c: any, index: number) => {
              const col = collections.find((col: Collection) => col.contract_address.toLowerCase() == c.collection_address.toLowerCase())
              const colName = col ? col.name : "-"
              return (
                <div key={index} className="flex items-center  relative  ">
                  <div className="flex-1 gap-2 items-center">
                    <Link href={`/collection/${c.collection_address}`} target="_blank">
                      {colName} #{c.token_id}
                    </Link>
                  </div>
                  <span className="flex-1 py-2 pl-6 flex  relative z-10">
                    <div className="flex gap-2 items-center">
                      <span>{Number(c.price) / 1e18}</span>
                      <FaEthereum />
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
          {!tokenBids.length && (
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
