import { Suspense } from "react"
import { notFound } from "next/navigation"
import { isAddress } from "viem"
import { NFTService } from "@/services/nft.service"
import NFTDetail from "@/components/features/nft/NftDetail"
import { NFTDetailSkeleton } from "@/components/features/nft/NftDetailSkeleton"

interface NFTPageProps {
  params: Promise<{
    colAddress: string
    tokenId: string
  }>
}

export default async function NFTPage({ params }: NFTPageProps) {
  const { colAddress, tokenId } = await params

  // Validation
  if (!isAddress(colAddress) || !/^\d{1,78}$/.test(tokenId)) {
    notFound()
  }

  // Fetch data on the server
  const nftData = await NFTService.getNFTDetail(colAddress, tokenId)

  if (!nftData) {
    notFound()
  }

  return (
    <div className="w-full min-h-screen px-1 pb-2 overflow-scroll pt-16">
      <Suspense fallback={<NFTDetailSkeleton />}>
        <NFTDetail nft={nftData} />
      </Suspense>
    </div>
  )
}

// Dynamic metadata for SEO
export async function generateMetadata({ params }: NFTPageProps) {
  const { colAddress, tokenId } = await params

  if (!isAddress(colAddress) || !/^\d{1,78}$/.test(tokenId)) {
    return { title: "NFT not found | Marketplace" }
  }

  const nftData = await NFTService.getNFTDetail(colAddress, tokenId)

  return {
    title: `${nftData?.name || `NFT #${tokenId}`} | Marketplace`,
    description: `View details for NFT #${tokenId} from collection ${colAddress}`,
    openGraph: {
      images: [nftData?.image_url ?? nftData?.token_uri ?? "/default-nft.png"],
    },
  }
}
