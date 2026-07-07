// app/collection/[colAddress]/page.tsx
import { getServerSupabase } from "@/lib/supabase/server"

import ColInfo from "../../../components/features/collections/collection/ColInfo"
import CollectionClientArea from "../../../components/features/collections/collection/CollectionClientArea"
import { notFound } from "next/navigation"
import { isAddress } from "viem"
import { NFTService } from "@/services/nft.service"

export default async function CollectionPage({ params }: { params: { colAddress: string } }) {
  const supabase = await getServerSupabase()
  const { colAddress } = await params

  if (!isAddress(colAddress)) notFound()

  const [initialNftsData, collectionBidsResult, collectionResult] = await Promise.all([
    NFTService.getCollectionNFTs(colAddress, { page: 1, limit: 24 }),

    supabase
      .from("collection_bids")
      .select("*")
      .eq("collection_address", colAddress.toLowerCase())
      .eq("is_active", true)
      .gt("expires_at", new Date().toISOString())
      .order("price", { ascending: false }),

    supabase.from("collections").select("floor_price").eq("contract_address", colAddress.toLowerCase()).single(),
  ])

  return (
    <div className="flex flex-col gap-1 relative w-full px-1 pb-6 pt-16">
      <div>
        <ColInfo colAddress={colAddress} />
      </div>
      <CollectionClientArea
        colAddress={colAddress}
        collectionBids={collectionBidsResult.data ?? []}
        initialNftsData={initialNftsData}
        initialFloorPrice={collectionResult.data?.floor_price?.toString() ?? "0"}
      />
    </div>
  )
}
