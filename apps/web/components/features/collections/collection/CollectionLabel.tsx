import { FaEthereum } from "react-icons/fa"

// Receives the collection DB row (with name) + derived item/listing arrays from
// UserSidebar. No on-chain reads — name comes from the DB.
export function CollectionLabel({ collection }: { collection: any }) {
  const name = collection.name || collection.symbol || "-"
  const listed = collection.colItems.filter((item: any) => Boolean(item.active_listing))
  const floor = [...collection.colListings].sort((a: any, b: any) => Number(a.price) - Number(b.price))

  return (
    <div className="flex flex-col justify-end w-full h-full">
      <div className="flex justify-between  rounded py-4 px-4 gap-1 w-full">
        <div className="flex flex-1 text-left items-center gap-2">
          <span className="font-bold text-xs">{name}</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          {floor.length ? (
            <span className="flex items-center gap-1">
              {Number(floor[0].price) / 1e18} <FaEthereum />
            </span>
          ) : (
            <span>-</span>
          )}
        </div>
        <div className="flex flex-1 justify-end gap-1 font-bold opacity-75">
          <div className="flex items-center">
            <span>{listed.length ? listed.length : "-"}</span>
            <span>/</span>
            <span>{collection.colItems.length}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
