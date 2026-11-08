import { TopCols24 } from "@/components/features/collections/TopCols24"
import { CollectionService } from "@/services/collections.service"
import { getServerSupabase } from "@/lib/supabase/server"
import { DATA_CHAIN_ID } from "@/lib/chainGuard"

export default async function Home() {
  const supabase = await getServerSupabase()

  const collections = await CollectionService.getTopCollectionsByVolume(supabase, DATA_CHAIN_ID)
  const collections24 = await CollectionService.getTopCollectionsByVolume24h(supabase, DATA_CHAIN_ID)

  return (
    <section className="w-full  grow   relative  h-full  flex flex-col gap-4  pt-15">
      <TopCols24 initialCollections={collections} initialCollections24={collections24} />
    </section>
  )
}
