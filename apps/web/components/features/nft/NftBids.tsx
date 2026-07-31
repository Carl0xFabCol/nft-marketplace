import { useTx } from "@/app/context/TxContext"
import { useAcceptTokenBid } from "@/hooks/useBidActions"
import Link from "next/link"
import { FaEthereum, FaExternalLinkAlt, FaGavel } from "react-icons/fa"
import { useConnection, usePublicClient } from "wagmi"

export default function NFTBids({ bids, owner }: any) {
  const { acceptTokenBid } = useAcceptTokenBid()
  const { addTx, updateTx, removeTx } = useTx()
  const publicClient = usePublicClient()

  const handleAcceptBid = async (bid: any) => {
    let hash: any
    try {
      // Signature is acceptTokenBid(collection, tokenId, bidder) — tokenId must
      // be the token id, not the bidder address.
      hash = await acceptTokenBid(bid.collection_address, Number(bid.token_id), bid.bidder_wallet)
      addTx({ hash, label: "Accepting token bid", status: "loading" })
      await publicClient?.waitForTransactionReceipt({ hash })
      updateTx(hash, { status: "success" })
      removeTx(hash)
    } catch (e) {
      console.error("Error accepting token bid: " + e)
      updateTx(hash, { status: "error" })
      removeTx(hash)
    }
  }

  if (bids.length > 0)
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
          {bids.map((bid: any, index: number) => {
            return (
              <div key={index} className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-(--accent)/5 border-b border-(--text)/10 transition-colors">
                {/* Event type */}
                <div className="col-span-3 flex items-center gap-2">
                  <span className="font-semibold">{Number(bid.price) / 1e18}</span>
                  <FaEthereum className="text-sm" />
                </div>

                {/* From */}
                <div className="col-span-3 flex items-center">
                  <Link href={`/user/${bid.bidder_wallet}`} className="font-mono text-sm hover:text-(--accent) transition-colors" onClick={(e) => e.stopPropagation()}>
                    {bid.bidder_wallet.slice(-7)}
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
