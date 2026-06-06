import { TopCols24 } from "@/components/features/collections/TopCols24"
import { CollectionService } from "@/services/collections.service"
import { createClient } from "@/lib/supabase/server"

export default async function Home() {
  const supabase = await createClient()

  const collections = await CollectionService.getTopCollectionsByVolume(supabase)
  const collections24 = await CollectionService.getTopCollectionsByVolume24h(supabase)

  return (
    <section className="w-full  grow   relative  h-full  flex flex-col gap-4 pt-15 ">
      <TopCols24 initialCollections={collections} initialCollections24={collections24} />
    </section>
  )
}
