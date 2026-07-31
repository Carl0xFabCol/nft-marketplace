// ─────────────────────────────────────────────────────────────────────────────
// components/features/user/UserHistory.tsx
// ─────────────────────────────────────────────────────────────────────────────
"use client"

import { FaEthereum, FaExternalLinkAlt, FaInbox } from "react-icons/fa"
import { useAccount } from "wagmi"
import { RiNftFill } from "react-icons/ri"
import Link from "next/link"
import { explorerTxUrl } from "@/lib/chains"

const CREATION_EVENTS = new Set(["LISTING_CREATED", "TOKEN_BID_PLACED", "COLLECTION_BID_PLACED", "COLLECTION_REGISTERED"])
const SALE_EVENTS = new Set(["SALE", "TOKEN_BID_ACCEPTED", "COLLECTION_BID_ACCEPTED"])
const CANCEL_EVENTS = new Set(["LISTING_CANCELLED", "COLLECTION_BID_CANCELLED", "TOKEN_BID_CANCELLED"])

const EVENT_COLOR: Record<string, string> = {
  creation: "text-[#6a6ac8]",
  sale: "text-[#5eb35e]",
  cancel: "text-[#c19137]",
}

function eventColor(event: string) {
  if (CREATION_EVENTS.has(event)) return EVENT_COLOR.creation
  if (SALE_EVENTS.has(event)) return EVENT_COLOR.sale
  if (CANCEL_EVENTS.has(event)) return EVENT_COLOR.cancel
  return ""
}

function eventLabel(event: string) {
  if (event === "COLLECTION_BID_CREATED") return "COLLECTION BID"
  return event.replace(/_/g, " ")
}

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

function AddressCell({ addr, self }: { addr: string | null; self: string | undefined }) {
  if (!addr) return <span>-</span>
  if (addr === self?.toLowerCase()) return <span>You</span>
  return <Link href={`/user/${addr}`}>{addr.slice(-6)}</Link>
}

interface ActivityRow {
  event: string
  token_id?: string | number
  price?: string | number | null
  from: string | null
  to: string | null
  tx_hash: string
  created_at: string
}

export default function UserHistory({ activity: actions }: { activity: ActivityRow[] }) {
  const { address } = useAccount()
  const self = address?.toLowerCase()

  if (!actions.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4">
        <FaInbox className="text-3xl" />
        <p>No actions found</p>
      </div>
    )
  }

  return (
    <div className="w-full rounded h-full overflow-hidden flex flex-col">
      <div className="flex justify-between px-4">
        {["Asset", "Action", "Price", "Seller", "Buyer", "Time", "Tx"].map((h) => (
          <span key={h} className="p-2 flex-1 first:flex-3 [&:nth-child(2)]:flex-2 last:flex-[0.1] [&:nth-child(6)]:flex-2">
            {h}
          </span>
        ))}
      </div>

      <div className="flex flex-col overflow-y-scroll">
        {actions.map((a: any, i: number) => (
          <div key={i} className="flex justify-between items-center relative px-2">
            <div className="p-2 flex flex-3 relative z-10">
              <div className="flex items-center gap-3">
                <RiNftFill className="text-xl" />
                <div className="flex flex-col items-start">
                  <span>{a.token_id ? `#${a.token_id}` : ""}</span>
                </div>
              </div>
            </div>

            <div className="p-2 flex flex-2 relative z-10">
              <span className={`p-2 rounded flex border text-center border-(--text-secondary)/30! text-xs bg-(--bg) px-4 ${eventColor(a.event)}`}>{eventLabel(a.event)}</span>
            </div>

            <div className="p-2 flex-1 relative z-10">
              {a.price ? (
                <div className="flex gap-2 items-center">
                  <span>{Number(a.price) / 1e18}</span>
                  <FaEthereum />
                </div>
              ) : (
                <span>-</span>
              )}
            </div>

            <div className="p-2 flex-1 relative z-10">
              <AddressCell addr={a.from} self={self} />
            </div>

            <div className="p-2 flex-1 relative z-10">
              <AddressCell addr={a.to} self={self} />
            </div>

            <div className="p-2 flex-2 relative z-10">
              <span>{dateFormatter.format(new Date(a.created_at))}</span>
            </div>

            <div className="p-2 flex-[0.1] relative z-10">
              <a target="_blank" href={explorerTxUrl(a.tx_hash)} className="flex gap-2 items-center">
                <FaExternalLinkAlt />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
