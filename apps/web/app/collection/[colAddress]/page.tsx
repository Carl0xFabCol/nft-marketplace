// app/collection/[colAddress]/page.tsx
import { getServerSupabase } from "@/lib/supabase/server"
import { COLLECTION_BID_COLUMNS } from "@/lib/supabase/columns"

import ColInfo from "../../../components/features/collections/collection/ColInfo"
import CollectionClientArea from "../../../components/features/collections/collection/CollectionClientArea"
import { notFound } from "next/navigation"
import { isAddress } from "viem"
import { NFTService } from "@/services/nft.service"
import { DATA_CHAIN_ID } from "@/lib/chainGuard"

export default async function CollectionPage({ params }: { params: { colAddress: string } }) {
  const supabase = await getServerSupabase()
  const { colAddress } = await params

  if (!isAddress(colAddress)) notFound()

  const chainId = DATA_CHAIN_ID

  const [initialNftsData, collectionBidsResult, collectionResult] = await Promise.all([
    NFTService.getCollectionNFTs(colAddress, { chainId, page: 1, limit: 24 }),

    supabase
      .from("collection_bids")
      .select(COLLECTION_BID_COLUMNS)
      .eq("collection_address", colAddress.toLowerCase())
      .eq("chain_id", chainId)
      .eq("is_active", true)
      .gt("expires_at", new Date().toISOString())
      .order("price", { ascending: false }),

    supabase
      .from("collections")
      .select("floor_price::text")
      .eq("contract_address", colAddress.toLowerCase())
      .eq("chain_id", chainId)
      .single(),
  ])

  return (
    <div className="flex flex-col gap-1 relative w-full px-1 pb-6 pt-16">
      <div>
        <ColInfo colAddress={colAddress} chainId={chainId} />
      </div>
      <CollectionClientArea
        colAddress={colAddress}
        chainId={chainId}
        collectionBids={collectionBidsResult.data ?? []}
        initialNftsData={initialNftsData}
        initialFloorPrice={collectionResult.data?.floor_price ?? "0"}
      />
    </div>
  )
}
