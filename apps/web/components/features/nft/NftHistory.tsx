import { FaEthereum, FaExternalLinkAlt } from "react-icons/fa"
import { MdCancel, MdGavel, MdLocalOffer, MdShoppingCart, MdSwapHoriz } from "react-icons/md"
import { Address } from "viem"
import { formatDistanceToNow } from "date-fns"
import Link from "next/link"
import { explorerTokenInstanceUrl, explorerTxUrl } from "@/lib/chains"

interface ActivityItem {
  id: string
  event: "COLLECTION_BID_CREATED" | "TRANSFER" | "LISTING" | "LISTING_CANCELLED" | "LISTING_SOLD" | "TOKEN_BID" | "TOKEN_BID_CANCELLED" | "COLLECTION_BID" | "COLLECTION_BID_CANCELLED"
  from: Address
  to: Address
  price?: string
  tx_hash: string
  created_at: string
}

interface NFTHistoryProps {
  nft: {
    history?: ActivityItem[]
    token_id: string
    collection_address: Address
  }
}

export function NFTHistory({ nft }: NFTHistoryProps) {
  const history = nft.history || []

  // Función para obtener icono según tipo de actividad.
  // Los eventos vienen en mayúsculas (p.ej. "SALE", "LISTING_CANCELLED",
  // "TOKEN_BID_PLACED") — comparar por mayúsculas / subcadenas, no exacto.
  const getActivityIcon = (type: string) => {
    const t = String(type).toUpperCase()
    if (t === "SALE" || t.includes("BID_ACCEPTED")) return <MdShoppingCart className="text-green-500" />
    if (t === "TRANSFER") return <MdSwapHoriz className="text-blue-500" />
    if (t.includes("CANCELLED") || t.includes("CANCEL")) return <MdCancel className="text-red-500" />
    if (t.includes("LISTING")) return <MdLocalOffer className="text-yellow-500" />
    if (t.includes("BID")) return <MdGavel className="text-purple-500" />
    return <MdSwapHoriz className="text-gray-500" />
  }

  // Función para formatear label del tipo
  const getActivityLabel = (type: string) => {
    let formatted = type.replaceAll("_", " ")
    return formatted.charAt(0) + formatted.slice(1).toLowerCase()
  }

  // Función para formatear dirección
  const formatAddress = (address: Address) => {
    if (!address) return "-"
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 opacity-50">
        <MdSwapHoriz className="text-4xl mb-2" />
        <p>No activity yet</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="grid grid-cols-12 gap-4 px-4 py-2 text-sm font-bold opacity-75 border-b border-(--text)/20">
        <div className="col-span-3">Event</div>
        <div className="col-span-2">Price</div>
        <div className="col-span-3">From</div>
        <div className="col-span-3">To</div>
        <div className="col-span-1">Time</div>
      </div>

      {/* Activity items */}
      <div className="flex flex-col max-h-96 overflow-y-auto">
        {history.map((activity) => {
          const timeAgo = formatDistanceToNow(new Date(activity.created_at), {
            addSuffix: true,
          })

          return (
            <div key={activity.id} className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-(--accent)/5 border-b border-(--text)/10 transition-colors">
              {/* Event type */}
              <div className="col-span-3 flex items-center gap-2">
                <div className="text-xl">{getActivityIcon(activity.event)}</div>
                <span className="font-semibold">{getActivityLabel(activity.event)}</span>
              </div>

              {/* Price */}
              <div className="col-span-2 flex items-center gap-1">
                {activity.price ? (
                  <>
                    <FaEthereum className="text-sm" />
                    <span className="font-bold">{(Number(activity.price) / 1e18).toFixed(4)}</span>
                  </>
                ) : (
                  <span className="opacity-50">—</span>
                )}
              </div>

              {/* From */}
              <div className="col-span-3 flex items-center">
                <a href={`/user/${activity.from}`} className="font-mono text-sm hover:text-(--accent) transition-colors" onClick={(e) => e.stopPropagation()}>
                  {formatAddress(activity.from)}
                </a>
              </div>

              {/* To */}
              <div className="col-span-3 flex items-center">
                <a href={`/user/${activity.to}`} className="font-mono text-sm hover:text-(--accent) transition-colors" onClick={(e) => e.stopPropagation()}>
                  {formatAddress(activity.to)}
                </a>
              </div>

              {/* Time + Tx link */}
              <div className="col-span-1 flex items-center gap-2">
                <span className="text-xs opacity-75">{timeAgo}</span>
                <a
                  href={explorerTxUrl(activity.tx_hash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs hover:text-(--accent) transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <FaExternalLinkAlt />
                </a>
              </div>
            </div>
          )
        })}
      </div>

      {/* View all on explorer */}
      {history.length > 0 && (
        <div className="flex justify-center pt-4 border-t border-(--text)/20">
          <Link
            href={explorerTokenInstanceUrl(nft.collection_address, nft.token_id)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm hover:text-(--accent) transition-colors"
          >
            <span>View all activity on Etherscan</span>
            <FaExternalLinkAlt className="text-xs" />
          </Link>
        </div>
      )}
    </div>
  )
}
