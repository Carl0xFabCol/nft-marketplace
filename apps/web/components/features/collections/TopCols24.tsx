"use client"
import { TopCollectionsSlider } from "./TopColsSlider"
import { useEffect, useState } from "react"
import { Collection } from "@/types/user.types"
import Link from "next/link"
import { FaEthereum } from "react-icons/fa"

interface props {
  initialCollections: Collection[]
  initialCollections24: Collection[]
}
export function TopCols24({ initialCollections, initialCollections24 }: props) {
  const [shownCollections, setShownCollections] = useState<Collection[]>(initialCollections)
  const [collectionsType, setCollectionsType] = useState<"trending" | "top">("top")

  useEffect(() => {
    setShownCollections(collectionsType == "top" ? initialCollections : initialCollections24)
  }, [collectionsType])

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
                <div className="flex flex-2 flex-col">
                  <div className="flex items-center gap-2">
                    {collection.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={collection.image_url} alt={collection.name?.toString()} className="w-6 h-6 rounded-full object-cover" />
                    )}
                    <span className="font-medium truncate max-w-[150px]">{collection.name?.toString()}</span>
                    {collection.is_verified && <span className="text-blue-400 text-xs">✓</span>}
                  </div>
                  <span className="text-xs opacity-50">{collection.symbol}</span>
                </div>

                {/* Floor price */}
                <div className="flex flex-1 items-center gap-1">
                  {collection.floor_price !== null && collection.floor_price.toString() !== "-" ? (
                    <>
                      <span>{typeof collection.floor_price === "number" ? (Number(collection.floor_price) / 1e18).toFixed(3) : Number(collection.floor_price) / 1e18}</span>
                      <FaEthereum className="text-xs" />
                    </>
                  ) : (
                    <span>-</span>
                  )}
                </div>

                {/* Royalty fee */}
                <div className="flex flex-1 items-center gap-1">
                  {collection.royalty_fee?.toString() !== "-" ? (
                    <>
                      <span>{Number(collection.royalty_fee) / 100}%</span>
                    </>
                  ) : (
                    <span>-</span>
                  )}
                </div>

                {/* Total volume */}
                <div className="flex flex-1 items-center gap-1">
                  {collection.total_volume?.toString() !== "-" ? (
                    <>
                      <span>{collection.total_volume?.toString()}</span>
                      <FaEthereum className="text-xs" />
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
