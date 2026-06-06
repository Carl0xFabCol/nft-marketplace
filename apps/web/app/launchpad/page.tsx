import MintForm from "@/components/MintForm"
import { RegisterCollection } from "@/components/RegisterCollection"
import { Collection, CollectionService } from "@/services/collections.service"

export default async function MintPage() {
  const { collections } = await CollectionService.getCollections({ page: 1, limit: 24, sortBy: "volume", sortDir: "desc", verified: false })

  return (
    <div className="flex gap-2 min-h-120 w-full max-w-full lg:w-[70%] mx-auto items-center relative pt-16">
      <div className="flex w-full flex-col flex-1 relative ">
        <div>
          <RegisterCollection />
        </div>
        <div>
          <div className="flex justify-end mb-5 "></div>
        </div>
        <p className="w-full text-center mb-4">Mint is live!</p>

        <div className="flex gap-4 rounded card w-full p-4 flex-col md:flex-row items-stretch ">
          {collections.map((col: Collection) => (
            <div className="flex-1 flex flex-col rounded border  border-(--accent)/30! bg-(--accent)/5 ">
              <MintForm contractAddress={col.contract_address} name={col.name || ""} symbol={col.symbol || ""} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
