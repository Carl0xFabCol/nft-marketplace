"use client"

import { useState } from "react"
import { useTx } from "@/app/context/TxContext"
import { useAcceptTokenBid } from "@/hooks/useBidActions"
import { useEnsureApproval } from "@/hooks/useEnsureApproval"
import Link from "next/link"
import { FaGavel } from "react-icons/fa"
import { HypeIcon } from "@/components/ui/HypeIcon"
import { useAccount, useConnection, usePublicClient } from "wagmi"
import { Address } from "viem"
import { UserTokenBid } from "@/types/user.types"
import { useRealtimeTable } from "@/hooks/useRealtimeTable"
import { toUserTokenBid, upsertTokenBid, deactivateTokenBid } from "@/lib/bidMerge"
import { waitForTxConfirmation } from "@/lib/tx"
import { assertWalletChain, chainGuardErrorMessage } from "@/lib/chainGuard"
import { BidAcceptanceError, type AcceptQuote } from "@/lib/bidAcceptance"
import { AcceptBidConfirm } from "@/components/features/nft/AcceptBidConfirm"

interface NFTBidsProps {
  bids: UserTokenBid[]
  chainId: number
  owner?: boolean
  /** Used for the realtime subscription filter. */
  collectionAddress: Address
  tokenId: string
}

export default function NFTBids({ bids, chainId, owner = false, collectionAddress, tokenId }: NFTBidsProps) {
  const [bidList, setBidList] = useState<UserTokenBid[]>(bids)
  const { quoteTokenBid, acceptTokenBid } = useAcceptTokenBid(chainId)
  const [pendingQuote, setPendingQuote] = useState<AcceptQuote | null>(null)
  const [accepting, setAccepting] = useState(false)
  const { ensureApproval } = useEnsureApproval(chainId)
  const { addTx, updateTx, removeTx } = useTx()
  const publicClient = usePublicClient({ chainId })
  const { address } = useAccount()
  const { chainId: connectedChainId } = useConnection()

  // Sync when the server re-delivers fresh bids (e.g. router.refresh()).
  const [prevBids, setPrevBids] = useState(bids)
  if (bids !== prevBids) {
    setPrevBids(bids)
    setBidList(bids)
  }

  // Live bid updates: a new offer on this token appears instantly; a
  // cancelled/accepted bid disappears without a reload. Realtime only supports
  // one column filter, so the token id is matched client-side.
  useRealtimeTable<UserTokenBid>({
    table: "token_bids",
    filter: `collection_address=eq.${collectionAddress.toLowerCase()}`,
    onChange: (change) => {
      const row = change.eventType === "DELETE" ? change.old : change.new
      if (!row || String(row.token_id) !== String(tokenId)) return

      const bid = toUserTokenBid(row)
      if (change.eventType === "DELETE" || bid.is_active === false) {
        setBidList((prev) => deactivateTokenBid(prev, bid))
      } else {
        setBidList((prev) => upsertTokenBid(prev, bid))
      }
    },
  })

  // Step 1: read the exact on-chain quote and show it (AcceptBidConfirm).
  const handleAcceptBid = async (bid: UserTokenBid) => {
    if (!address || !bid.collection_address || !bid.token_id || !bid.bidder_wallet || bid.price == null) return

    try {
      assertWalletChain(connectedChainId, chainId)
    } catch (error) {
      alert(chainGuardErrorMessage(error))
      return
    }

    try {
      const quote = await quoteTokenBid({
        collection: bid.collection_address as Address,
        tokenId: BigInt(bid.token_id),
        bidder: bid.bidder_wallet as Address,
        shownPrice: BigInt(bid.price),
      })
      setPendingQuote(quote)
    } catch (e) {
      console.error("Error quoting token bid:", e)
      alert(e instanceof BidAcceptanceError ? e.message : "Could not read this bid on-chain. Try again.")
    }
  }

  // Step 2: the seller confirmed exactly this quote.
  const handleConfirmAccept = async (quote: AcceptQuote) => {
    if (!address) return
    let hash: `0x${string}` | undefined
    setAccepting(true)

    try {
      assertWalletChain(connectedChainId, chainId)
      await ensureApproval(quote.collection, address)

      hash = await acceptTokenBid(quote)
      setPendingQuote(null)
      addTx({ hash, label: "Accepting token bid", status: "loading" })

      await waitForTxConfirmation(publicClient, hash)

      updateTx(hash, { status: "success", label: "Token bid accepted!" })
      setTimeout(() => removeTx(hash!), 5000)
    } catch (e) {
      console.error("Error accepting token bid: " + e)
      const guardMessage = chainGuardErrorMessage(e)
      if (guardMessage) alert(guardMessage)
      if (hash) {
        updateTx(hash, { status: "error", label: "Accept bid failed" })
        setTimeout(() => removeTx(hash!), 6000)
      }
    } finally {
      setAccepting(false)
    }
  }

  const confirmPanel = <AcceptBidConfirm quote={pendingQuote} busy={accepting} onConfirm={handleConfirmAccept} onCancel={() => setPendingQuote(null)} />

  if (bidList.length > 0)
    return (
      <div className="flex flex-col gap-2">
        {confirmPanel}
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
                  <HypeIcon className="text-sm" />
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
