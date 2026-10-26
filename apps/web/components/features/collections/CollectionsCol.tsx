// components/features/collections/CollectionsCol.tsx
"use client"

import Link from "next/link"
import { HypeIcon } from "@/components/ui/HypeIcon"
import { Collection } from "@/types/user.types"
import { MdOutlineVerified } from "react-icons/md"

interface CollectionsColProps {
  collections: Collection[]
}

// Renders entirely from the server-fetched `collections` rows (which already
// include name, floor_price, royalty_fee, total_volume, nft_count and top_bid).
// No on-chain reads needed — the DB is maintained by the indexer/triggers.
export default function CollectionsCol({ collections }: CollectionsColProps) {
  if (!collections.length) {
    return (
      <div className="flex flex-col w-full text-(--text)! card rounded-b p-8 text-center">
        <p className="opacity-50">No collections found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col w-full text-(--text)! card rounded-b">
      {collections.map((collection: Collection) => {
        const name = collection.name || "-"
        const floorFromDB = collection.floor_price ? Number(collection.floor_price) / 1e18 : null
        const royaltyFee = collection.royalty_fee != null ? collection.royalty_fee / 100 : "-"
        const totalVol = collection.total_volume != null ? collection.total_volume : "-"
        const supply = collection.nft_count || "-"

        return (
          <Link href={`/collection/${collection.contract_address}`} key={collection.contract_address} className="flex group justify-between items-center w-full p-2">
            <div className="flex justify-between items-center w-full p-2 transition-all duration-200 group-hover:bg-(--accent)/20 rounded">
              {/* Collection info */}
              <div className="flex flex-2 items-center gap-2">
                {collection.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={collection.image_url} alt={name} className="w-8 h-8 rounded object-cover" />
                )}
                <div className="flex items-start flex-col">
                  <span className="font-medium truncate ">{name}</span>
                  <span className="text-xs opacity-50">{collection.symbol}</span>
                </div>
                {collection.is_verified && (
                  <span className="text-blue-400 ">
                    <MdOutlineVerified />
                  </span>
                )}
              </div>

              {/* Floor price */}
              <div className="flex flex-1 items-center gap-1">
                {floorFromDB !== null ? (
                  <>
                    <span>{floorFromDB.toFixed(3)}</span>
                    <HypeIcon className="text-xs" />
                  </>
                ) : (
                  <span>-</span>
                )}
              </div>

              {/* Top bid */}
              <div className="flex flex-1 items-center gap-1">
                {collection.top_bid ? (
                  <>
                    <span>{(Number(collection.top_bid.price) / 1e18).toFixed(3)}</span>
                    <HypeIcon className="text-xs" />
                  </>
                ) : (
                  <span>-</span>
                )}
              </div>

              {/* Royalty fee */}
              <div className="flex flex-1">
                <span>{royaltyFee !== "-" ? `${royaltyFee}%` : "-"}</span>
              </div>

              {/* Total volume */}
              <div className="flex flex-1 items-center gap-1">
                {totalVol !== "-" ? (
                  <>
                    <span>{totalVol}</span>
                    <HypeIcon className="text-xs" />
                  </>
                ) : (
                  <span>-</span>
                )}
              </div>

              {/* Supply */}
              <div className="flex flex-1">
                <span>{supply}</span>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
