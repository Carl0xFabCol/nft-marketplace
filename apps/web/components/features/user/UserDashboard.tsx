"use client"

import { useState } from "react"
import { Address } from "viem"
import { useAccount } from "wagmi"
import { useBatchOperations } from "@/hooks/useBatchOperations"
import { ProfileNftOption, UserPageData, UserProfile } from "@/types/user.types"
import UserHeader from "./UserHeader"
import { UserProfileEditor } from "./UserProfileEditor"
import UserSidebar from "./UserSidebar"
import UserInventory from "./UserInventory"
import UserCollectionBids from "./UserCollectionBids"
import UserTokenBids from "./UserTokenBids"
import UserHistory from "./UserHistory"
import { AnimatePresence, motion } from "framer-motion"

export type ViewType = "inventory" | "colBids" | "tokenBids" | "history"

const VIEW_ORDER: Record<ViewType, number> = {
  inventory: 1,
  colBids: 2,
  tokenBids: 3,
  history: 4,
}

const slideVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 60 : -60 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir < 0 ? 60 : -60 }),
}

interface UserDashboardProps {
  userAddress: Address
  initialData: UserPageData
  profile: UserProfile | null
  avatarOptions: ProfileNftOption[]
}

export default function UserDashboard({ userAddress, initialData, profile, avatarOptions }: UserDashboardProps) {
  const [currentView, setCurrentView] = useState<ViewType>("inventory")
  const [selectedCollection, setSelectedCollection] = useState<Address | "">("")
  const [showSidebar, setShowSidebar] = useState(false)
  const [showProfileEditor, setShowProfileEditor] = useState(false)
  const [direction, setDirection] = useState(0)

  const { address } = useAccount()
  const isOwner = address?.toLowerCase() === userAddress.toLowerCase()

  const batchOps = useBatchOperations()

  const filteredNFTs = selectedCollection ? initialData.nfts.filter((nft) => nft.collection_address.toLowerCase() === selectedCollection.toLowerCase()) : initialData.nfts

  const handleViewChange = (view: ViewType) => {
    setDirection(VIEW_ORDER[view] - VIEW_ORDER[currentView])
    setCurrentView(view)
  }

  return (
    <div className="flex px-1 gap-2 w-full relative min-h-0 max-h-screen">
      <motion.div layout="size" transition={{ layout: { duration: 0.3 } }} className="flex lg:gap-1 relative grow">
        <AnimatePresence>
          {showSidebar && (
            <motion.div layout="position" initial={{ width: 0 }} animate={{ width: 280 }} exit={{ width: 0 }} transition={{ duration: 0.3, ease: "easeInOut" }} className="overflow-hidden">
              <UserSidebar
                collections={initialData.collections}
                nfts={initialData.nfts}
                listings={initialData.listings}
                selectedCollection={selectedCollection}
                onSelectCollection={(address: Address | "") => setSelectedCollection(address)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div layout="size" transition={{ layout: { duration: 0.3, ease: "easeInOut" } }} className="flex flex-2 flex-col overflow-scroll p-4 card rounded">
          <motion.div layout="position" className="shrink-0 card z-15">
            <UserHeader
              userAddress={userAddress}
              selectedCollection={selectedCollection}
              collections={initialData.collections}
              currentView={currentView}
              onViewChange={handleViewChange}
              onToggleSidebar={() => setShowSidebar((v) => !v)}
              showSidebar={showSidebar}
              profile={profile}
              isOwner={isOwner}
              onEditProfile={() => setShowProfileEditor(true)}
            />
          </motion.div>

          <div>
            <motion.div layout="position" className="relative min-h-0 grow">
              <AnimatePresence mode="popLayout" custom={direction}>
                <motion.div
                  layout="position"
                  key={currentView}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="flex flex-col min-h-0 grow"
                >
                  {currentView === "inventory" && (
                    <UserInventory
                      userAddress={userAddress}
                      initialNfts={filteredNFTs}
                      listings={initialData.listings}
                      hasMoreNfts={initialData.hasMore}
                      collections={initialData.collections}
                      batchOps={batchOps}
                    />
                  )}
                  {currentView === "colBids" && (
                    <UserCollectionBids collections={initialData.collections} collectionBids={initialData.collectionBids} batchOps={batchOps} userAddress={userAddress} />
                  )}
                  {currentView === "tokenBids" && (
                    <UserTokenBids collections={initialData.collections} tokenBids={initialData.tokenBids} selectedCollection={selectedCollection} batchOps={batchOps} userAddress={userAddress} />
                  )}
                  {currentView === "history" && <UserHistory activity={initialData.activity} userAddress={userAddress} totalPages={initialData.activityTotalPages ?? 1} />}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </div>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {showProfileEditor && (
          <UserProfileEditor userAddress={userAddress} profile={profile} avatarOptions={avatarOptions} onClose={() => setShowProfileEditor(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
