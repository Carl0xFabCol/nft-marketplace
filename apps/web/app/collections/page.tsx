import CollectionsCol from "../../components/features/collections/CollectionsCol"
import { CollectionsSearch } from "@/components/features/collections/CollectionsSearch"
import { CollectionService } from "@/services/collections.service"
import { Collection } from "@/types/user.types"
import { Pagination } from "@/components/ui/ServerPagination"
import { getServerSupabase } from "@/lib/supabase/server"
import { clampInt, sanitizePostgrestSearch } from "@/lib/validation"

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const supabase = await getServerSupabase()
  const { page: pageStr, q } = await searchParams
  const page = clampInt(pageStr, 1, 1, 100_000)
  const search = (typeof q === "string" ? q : "").trim().slice(0, 64)

  const { collections, totalPages } = await CollectionService.getCollectionsWithTopBids(supabase, {
    page,
    limit: 20,
    search: sanitizePostgrestSearch(search) || undefined,
  })

  return (
    <div className="w-full flex flex-col px-1 pt-16 gap-1">
      <div className="flex card rounded flex-col w-full p-2 gap-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className="text-3xl font-bold">Collections</h1>
          <CollectionsSearch initialQuery={search} />
        </div>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4">
          <Pagination currentPage={page} totalPages={totalPages} baseUrl="/collections" query={{ q: search || undefined }} />
        </div>
      )}
    </div>
  )
}
