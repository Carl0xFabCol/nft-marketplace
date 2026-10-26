// ─────────────────────────────────────────────────────────────────────────────
// app/user/[userAddress]/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
import { notFound } from "next/navigation"
import { isAddress } from "viem"
import { UserService } from "@/services/user.service"
import UserDashboard from "@/components/features/user/UserDashboard"
import { getServerSupabase } from "@/lib/supabase/server"

interface UserPageProps {
  params: Promise<{ userAddress: string }>
}

export default async function UserPage({ params }: UserPageProps) {
  const { userAddress } = await params
  const supabase = await getServerSupabase()
  if (!isAddress(userAddress)) notFound()

  const [userData, profile, avatarOptions] = await Promise.all([
    UserService.getUserData(supabase, userAddress),
    UserService.getUserProfile(supabase, userAddress).catch((error) => {
      console.error("Failed to load user profile:", error)
      return null
    }),
    UserService.getProfileAvatarOptions(supabase, userAddress).catch((error) => {
      console.error("Failed to load profile picture options:", error)
      return []
    }),
  ])

  return (
    <div className="w-full pb-5 pt-16">
      <UserDashboard userAddress={userAddress} initialData={userData} profile={profile} avatarOptions={avatarOptions} />
    </div>
  )
}

export async function generateMetadata({ params }: UserPageProps) {
  const { userAddress } = await params

  if (!isAddress(userAddress)) {
    return { title: "User not found | NFT Marketplace" }
  }

  return {
    title: `User ${userAddress.slice(0, 6)}...${userAddress.slice(-4)} | NFT Marketplace`,
    description: `View NFTs, listings, and bids for ${userAddress}`,
  }
}
