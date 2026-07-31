import { CollectionLabel } from "@/components/features/collections/collection/CollectionLabel"
import { FaSearch } from "react-icons/fa"
import { Address } from "viem"
import { Collection, EnrichedUserNFT, UserListing } from "@/types/user.types"

interface UserSidebarProps {
  collections: Collection[]
  nfts: EnrichedUserNFT[]
  listings: UserListing[]
  selectedCollection: Address | ""
  onSelectCollection: (address: Address | "") => void
}

export default function UserSidebar({ collections, nfts, listings, selectedCollection, onSelectCollection }: UserSidebarProps) {
  return (
    <div className=" flex-1 card w-full rounded overflow-hidden">
      <div className="flex flex-col  h-full   ">
        <div className="flex flex-col gap-3 px-4 ">
          <div className="flex items-center gap-2 pt-2">
            <label className="flex items-center gap-3 bg-(--bg)/80 p-2 rounded-xl w-full border-(--text)/10 border">
              <FaSearch className="opacity-50" />
              <input type="text" className="bg-transparent! w-full" placeholder="Search collection" />
            </label>
          </div>
          <div className="flex flex-col gap-2 pb-4">
            <div className="flex  px-4">
              <span className="flex-1 text-left">Name</span>
              <span className="flex-1 text-center">Floor</span>
              <span className="flex-1 text-right">Listed</span>
            </div>
            <div>
              <div className="flex flex-col justify-end w-full h-full">
                <div
                  onClick={() => onSelectCollection("")}
                  className={
                    "card  hover:cursor-pointer hover:border-(--accent)/50 rounded border border-(--text)/20 flex justify-between px-4 py-2 " +
                    (!selectedCollection ? " bg-(--accent)/50! text-(--bg-secondary)!" : " ")
                  }
                >
                  <div className="flex flex-1 text-left items-center gap-2">
                    <span className="font-bold text-xs">All collections</span>
                  </div>
                  <div className="flex-1 text-center"></div>
                  <div className="flex flex-1 justify-end items-center gap-1 font-bold opacity-75">
                    <div>
                      <span>{listings.length ? listings.length : "-"}</span>
                      <span>/</span>
                      <span>{nfts.length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {collections.map((col) => {
              const colItems = nfts.filter((item) => String(item.collection_address).toLowerCase() == String(col.contract_address).toLowerCase())
              const colListings = listings.filter((l) => String(l.collection_address).toLowerCase() == String(col.contract_address).toLowerCase())
              return (
                <div
                  key={col.contract_address}
                  className={
                    "card rounded border hover:cursor-pointer hover:border-(--accent)/50 border-(--text)/20" +
                    (selectedCollection == col.contract_address ? " bg-(--accent)/50! text-(--bg-secondary)!" : " ")
                  }
                  onClick={() => {
                    onSelectCollection(col.contract_address.toLowerCase() as Address)
                  }}
                >
                  <CollectionLabel collection={{ collection: col.contract_address, name: col.name, symbol: col.symbol, colItems: colItems, colListings: colListings }} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
