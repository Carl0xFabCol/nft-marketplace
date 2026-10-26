import { useMemo } from "react"
import { FaExternalLinkAlt, FaGavel, FaHistory, FaTimes, FaUser } from "react-icons/fa"
import { FiCopy, FiEdit3 } from "react-icons/fi"
import { HiOutlineCollection } from "react-icons/hi"
import { IoIosArrowBack } from "react-icons/io"
import { IoFilter } from "react-icons/io5"
import { Address } from "viem"
import { explorerAddressUrl, explorerTokenUrl } from "@/lib/chains"
import { Collection, UserProfile } from "@/types/user.types"
import { IpfsImage } from "@/components/features/nft/IpfsImage"
import { ViewType } from "./UserDashboard"

interface UserHeaderProps {
  userAddress: Address
  selectedCollection: Address | ""
  collections: Collection[]
  currentView: ViewType
  onViewChange: (view: ViewType) => void
  onToggleSidebar: () => void
  showSidebar: boolean
  profile: UserProfile | null
  isOwner: boolean
  onEditProfile: () => void
}

export default function UserHeader({
  userAddress,
  selectedCollection,
  collections,
  currentView,
  onViewChange,
  onToggleSidebar,
  showSidebar,
  profile,
  isOwner,
  onEditProfile,
}: UserHeaderProps) {
  const copyToClipboard = (value: string) => {
    navigator.clipboard.writeText(value)
  }

  const colName = useMemo(() => {
    const col = collections.find((col: Collection) => col.contract_address == selectedCollection)
    return col ? col.name : ""
  }, [collections, selectedCollection])
  return (
    <div>
      <div className="w-full flex  flex-col  gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-(--text)/20 bg-(--bg)">
              {profile?.avatar_url ? (
                <IpfsImage src={profile.avatar_url} alt={profile.username ?? "Profile picture"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <FaUser className="text-2xl opacity-40" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="max-w-full truncate text-xl font-bold">
                  {profile?.username || `${String(userAddress)?.slice(0, 7)}...${String(userAddress)?.slice(-7)}`}
                </h2>
                <button onClick={() => copyToClipboard(userAddress)} className="bg-transparent! text-(--text)! hover:opacity-75!">
                  <FiCopy className="text-xl" />
                </button>
                <a href={explorerAddressUrl(userAddress)} target="_blank">
                  <FaExternalLinkAlt className="text-[17px] hover:cursor-pointer hover:opacity-75" />
                </a>
                {isOwner && (
                  <span className="ml-2 border-l border-(--text)/20 pl-3">
                    <button
                      onClick={onEditProfile}
                      className="flex items-center gap-1 rounded border border-(--text)/20 bg-transparent! px-2 py-1 text-xs text-(--text)! hover:opacity-75!"
                    >
                      <FiEdit3 />
                      Edit profile
                    </button>
                  </span>
                )}
              </div>
              {profile?.username && (
                <p className="font-mono text-xs opacity-60">
                  {String(userAddress)?.slice(0, 7)}...{String(userAddress)?.slice(-7)}
                </p>
              )}
              {profile?.bio && <p className="mt-1 max-w-2xl whitespace-pre-line break-words text-sm opacity-75">{profile.bio}</p>}
            </div>
          </div>
          <button onClick={() => onToggleSidebar()} className="bg-transparent! lg:hidden text-(--text)! p-4">
            <FaTimes />
          </button>
        </div>

        <div className="flex gap-4 items-center text-2xl">
          <button onClick={() => onToggleSidebar()} className="  text-(--secondary)! bg-transparent!">
            {/* <HiOutlineCollection className="" /> */}
            {!showSidebar && <IoFilter />}
            {showSidebar && <IoIosArrowBack />}
          </button>
          <h2>{selectedCollection && colName ? colName : "All collections"}</h2>

          {selectedCollection && (
            <div className=" flex gap-2 items-center">
              <button onClick={() => copyToClipboard(selectedCollection)} className="bg-transparent! text-(--text)! hover:opacity-75!">
                <FiCopy className=" text-xl" />
              </button>
              <a href={explorerTokenUrl(selectedCollection)} target="_blank">
                <FaExternalLinkAlt className="hover:opacity-75 hover:cursor-pointer text-[17px]" />
              </a>
            </div>
          )}
        </div>

        <div className="flex gap-3 items-center"></div>
      </div>
      <div className=" w-full flex  border-b border-(--text)/20  mb-2">
        <button
          onClick={() => onViewChange("inventory")}
          className={"flex items-center gap-2 bg-transparent! border-b p-2 px-4 " + (currentView == "inventory" ? " text-(--accent)! " : "text-(--text)/80! border-transparent!")}
        >
          <HiOutlineCollection />
          <span>Inventory</span>
        </button>
        <button
          onClick={() => onViewChange("colBids")}
          className={"flex items-center gap-2 bg-transparent! border-b p-2 px-4 " + (currentView == "colBids" ? " text-(--accent)! " : "text-(--text)/80! border-transparent!")}
        >
          <FaGavel />
          <span>Collection bids</span>
        </button>
        <button
          onClick={() => onViewChange("tokenBids")}
          className={"flex items-center gap-2 bg-transparent! border-b p-2 px-4 " + (currentView == "tokenBids" ? " text-(--accent)! " : "text-(--text)/80! border-transparent!")}
        >
          <FaGavel />
          <span>Token bids</span>
        </button>
        <button
          onClick={() => onViewChange("history")}
          className={"flex items-center gap-2 bg-transparent! border-b p-2 px-4 " + (currentView == "history" ? " text-(--accent)! " : "text-(--text)/80! border-transparent!")}
        >
          <FaHistory />
          <span>History</span>
        </button>
      </div>
    </div>
  )
}
