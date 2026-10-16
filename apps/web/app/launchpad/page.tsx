import { Suspense } from "react"
import { CollectionService } from "@/services/collections.service"
import { getServerSupabase } from "@/lib/supabase/server"
import { RegisterCollection } from "@/components/RegisterCollection"
import { LaunchCollection } from "@/components/launchpad/LaunchCollection"
import { CollectionCard } from "@/components/launchpad/CollectionCard"
import { CollectionsSkeleton } from "@/components/launchpad/CollectionsSkeleton"
import { EmptyState } from "@/components/launchpad/EmptyState"

export default function MintPage() {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 pt-24 pb-16">
      {/* Header */}
      <header className="mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold mb-2">Launchpad</h1>
          <p className="text-(--muted) max-w-xl">Discover collections, mint new NFTs, and launch your own contract on the network.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 self-start">
          <LaunchCollection />
          <RegisterCollection />
        </div>
      </header>

      {/* Grid con Suspense */}
      <Suspense fallback={<CollectionsSkeleton />}>
        <CollectionsGrid />
      </Suspense>
    </div>
  )
}

async function CollectionsGrid() {
  const supabase = await getServerSupabase()
  const { collections } = await CollectionService.getCollections(supabase, {
    page: 1,
    limit: 24,
    sortBy: "volume",
    sortDir: "desc",
  })

  if (!collections?.length) {
    return <EmptyState />
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {collections.map((col: any) => (
        <CollectionCard key={col.contract_address} collection={col} />
      ))}
    </div>
  )
}
