"use client"
import { TopCollectionsSlider } from "./TopColsSlider"
import { useState } from "react"
import { Collection } from "@/types/user.types"
import Link from "next/link"
import { HypeIcon } from "@/components/ui/HypeIcon"
import { MdOutlineVerified } from "react-icons/md"

interface props {
  initialCollections: Collection[]
  initialCollections24: Collection[]
}
export function TopCols24({ initialCollections, initialCollections24 }: props) {
  const [collectionsType, setCollectionsType] = useState<"trending" | "top">("top")
  // Derived directly from props so the list can never go stale when the server
  // re-renders with fresh collections.
  const shownCollections = collectionsType === "top" ? initialCollections : initialCollections24

  return (
    <div className="w-full pb-4">
      <TopCollectionsSlider collections={initialCollections} />
      <div className="card ">
        <div className="flex gap-4 border-b border-(--text)/20 py-4 px-2 w-full text-(--text)">
          <button onClick={() => setCollectionsType("top")} className={"bg-transparent! text-(--text)! " + (collectionsType == "top" ? " " : " opacity-50")}>
            <h2 className="">Top Collections</h2>
          </button>

          <button onClick={() => setCollectionsType("trending")} className={"bg-transparent! text-(--text)! " + (collectionsType == "trending" ? " " : " opacity-50")}>
            <h2 className="">Trending 24h</h2>
          </button>
        </div>
        <div className="p-4 flex w-full items-center text-sm">
          <div className="flex-2">
            <span>Collection</span>
          </div>
          <div className="flex-1">
            <span>Floor</span>
          </div>
          <div className="flex-1">
            <span>Royalty fee</span>
          </div>
          <div className="flex-1">
            <span>Total volume</span>
          </div>
          <div className="flex-1 ">
            <span>Supply</span>
          </div>
        </div>
        {shownCollections.map((collection: Collection) => {
          return (
            <Link href={`/collection/${collection.contract_address}`} key={collection.contract_address} className="flex group justify-between items-center w-full p-2">
              <div className="flex justify-between items-center w-full p-2 transition-all duration-200 group-hover:bg-(--accent)/20 rounded">
                {/* Collection info */}
                <div className="flex flex-2 items-center gap-2">
                  {collection.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={collection.image_url} alt={collection.name?.toString()} className="w-8 h-8 rounded object-cover" />
                  )}
                  <div className="flex flex-col items-start ">
                    <span className="font-medium truncate ">{collection.name?.toString()}</span>
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
                  {collection.floor_price != null ? (
                    <>
                      <span>{(Number(collection.floor_price) / 1e18).toFixed(3)}</span>
                      <HypeIcon className="text-xs" />
                    </>
                  ) : (
                    <span>-</span>
                  )}
                </div>

                {/* Royalty fee */}
                <div className="flex flex-1 items-center gap-1">
                  {collection.royalty_fee != null ? (
                    <span>{Number(collection.royalty_fee) / 100}%</span>
                  ) : (
                    <span>-</span>
                  )}
                </div>

                {/* Total volume */}
                <div className="flex flex-1 items-center gap-1">
                  {collection.total_volume != null ? (
                    <>
                      <span>{collection.total_volume}</span>
                      <HypeIcon className="text-xs" />
                    </>
                  ) : (
                    <span>-</span>
                  )}
                </div>

                {/* Supply */}
                <div className="flex flex-1">
                  <span>{collection.nft_count}</span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
