"use server"
import CollectionsCol from "../../components/features/collections/CollectionsCol"
import { Collection, CollectionService } from "@/services/collections.service"
import { Pagination } from "@/components/ui/ServerPagination"
import { getServerSupabase } from "@/lib/supabase/server"

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const supabase = await getServerSupabase()
  const { page: pageStr } = await searchParams
  const page = Number(pageStr) || 1

  const { collections, totalPages } = await CollectionService.getCollectionsWithTopBids(supabase, {
    page,
    limit: 20,
  })

  return (
    <div className="w-full flex flex-col px-1 pt-16">
      <div className="flex card rounded flex-col w-full">
        <div className="p-4 flex w-full items-center text-sm">
          <div className="flex-2">
            <span>Collection</span>
          </div>
          <div className="flex-1">
            <span>Floor</span>
          </div>
          <div className="flex-1">
            <span>Top bid</span>
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
      </div>
      <div>
        <CollectionsCol collections={collections as Collection[]} />
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="mt-4">
          <Pagination currentPage={page} totalPages={totalPages} baseUrl="/collections" />
        </div>
      )}
    </div>
  )
}
