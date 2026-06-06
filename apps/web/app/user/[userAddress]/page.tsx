// ─────────────────────────────────────────────────────────────────────────────
// app/user/[userAddress]/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
import { notFound } from "next/navigation"
import { isAddress } from "viem"
import { UserService } from "@/services/user.service"
import UserDashboard from "@/components/features/user/UserDashboard"
import { createClient } from "@/lib/supabase/server"

interface UserPageProps {
  params: Promise<{ userAddress: string }>
}

export default async function UserPage({ params }: UserPageProps) {
  const { userAddress } = await params
  const supabase = await createClient()
  if (!isAddress(userAddress)) notFound()

  const userData = await UserService.getUserData(supabase, userAddress)

  return (
    <div className="w-full pb-5 pt-16">
      <UserDashboard userAddress={userAddress} initialData={userData} />
    </div>
  )
}

export async function generateMetadata({ params }: UserPageProps) {
  const { userAddress } = await params
  return {
    title: `User ${userAddress.slice(0, 6)}...${userAddress.slice(-4)} | NFT Marketplace`,
    description: `View NFTs, listings, and bids for ${userAddress}`,
  }
}
