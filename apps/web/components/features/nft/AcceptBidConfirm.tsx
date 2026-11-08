"use client"

import { AnimatePresence } from "framer-motion"
import { createPortal } from "react-dom"
import { FaGavel } from "react-icons/fa"
import { formatEther } from "viem"
import { Modal } from "@/components/ui/Modal"
import { HypeIcon } from "@/components/ui/HypeIcon"
import type { AcceptQuote, RoyaltySource } from "@/lib/bidAcceptance"

// Confirmation step for accepting a bid (ABI-1). The numbers shown here are the
// exact quote the hook signs: minPrice = price, minSellerProceeds = "You
// receive" (0 slippage). All values are bigint wei, formatted with formatEther.

const SOURCE_LABEL: Record<RoyaltySource, string> = {
  override: "marketplace override",
  erc2981: "collection ERC-2981",
  collection: "marketplace default",
}

function Row({ label, value, strong = false, note }: { label: string; value: bigint; strong?: boolean; note?: string }) {
  return (
    <div className={`flex justify-between gap-6 ${strong ? "font-bold text-lg" : "text-sm"}`}>
      <span className={strong ? "" : "opacity-75"}>
        {label}
        {note && <span className="opacity-60"> ({note})</span>}
      </span>
      <span className="flex items-center gap-1 font-mono">
        {formatEther(value)}
        <HypeIcon className="text-sm" />
      </span>
    </div>
  )
}

export interface AcceptBidConfirmProps {
  quote: AcceptQuote | null
  busy?: boolean
  onConfirm: (quote: AcceptQuote) => void
  onCancel: () => void
}

export function AcceptBidConfirm({ quote, busy = false, onConfirm, onCancel }: AcceptBidConfirmProps) {
  // Portaled: callers sit inside cards whose CSS filter/transform would
  // otherwise become the containing block of the fixed-position modal. Only
  // mounted while a quote exists (after a click), so SSR/hydration never sees it.
  if (!quote || typeof document === "undefined") return null
  return createPortal(
    <AnimatePresence>
      {quote && (
        <Modal id="accept-bid" title="Accept bid" icon={<FaGavel />} onClose={busy ? () => {} : onCancel} panelClassName="min-w-80 max-w-md">
          <div className="flex flex-col gap-2 p-4 pt-0">
            {quote.tokenIds.length > 1 ? (
              <Row label={`Bid price (${quote.tokenIds.length} × ${formatEther(quote.price)})`} value={quote.total} />
            ) : (
              <Row label="Bid price" value={quote.price} />
            )}
            <Row label="Marketplace fee" note={`${Number(quote.marketplaceFeeBps) / 100}%`} value={-quote.marketplaceFee} />
            <Row label="Royalty" note={quote.royaltySources.map((s) => SOURCE_LABEL[s]).join(", ")} value={-quote.royalty} />
            <div className="border-t border-(--text)/20 my-1" />
            <Row label="You receive" value={quote.proceeds} strong />
            <p className="text-xs opacity-60 mt-1">
              The transaction reverts if the bid price or your proceeds would be lower than shown (fee or royalty changed in between).
            </p>
            <div className="flex gap-2 mt-2">
              <button onClick={onCancel} disabled={busy} className="flex-1 rounded p-2 bg-transparent! border border-(--text)/30 text-(--text)!">
                Cancel
              </button>
              <button onClick={() => onConfirm(quote)} disabled={busy} className="flex-1 rounded p-2">
                {busy ? "Confirm in wallet…" : "Confirm"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </AnimatePresence>,
    document.body,
  )
}
