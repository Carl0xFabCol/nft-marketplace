"use client"

import { AnimatePresence } from "framer-motion"
import { FaInbox } from "react-icons/fa"
import { useMemo, useState, useEffect, useCallback, useRef } from "react"
import { Address } from "viem"
import { NFTCard } from "../nft/NftCard"
import { UserListCard } from "./UserListCard"
import { useUserNfts } from "@/hooks/useUserNfts"
import { EnrichedUserNFT } from "@/types/user.types"
import { useAccount } from "wagmi"
import { IoIosArrowDown } from "react-icons/io"
import { SortBy, SortDir } from "@/lib/constants"
import { UserService } from "@/services/user.service"
import { supabase } from "@/lib/supabase/client"

interface UserInventoryProps {
  userAddress: Address
  initialNfts: EnrichedUserNFT[]
  collections: any[]
  batchOps: any
  hasMoreNfts: boolean
}

export default function UserInventory({ userAddress, initialNfts, hasMoreNfts, collections, batchOps }: UserInventoryProps) {
  const [showListCard, setShowListCard] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>("price")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [searchQuery, setSearchQuery] = useState("")
  const [nfts, setNfts] = useState(initialNfts)
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(hasMoreNfts)
  const [currentPage, setCurrentPage] = useState(1)
  const [isMounted, setIsMounted] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)
  const observerRef = useRef<HTMLDivElement | null>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const { address } = useAccount()
  const isOwner = isMounted && address?.toLowerCase() === userAddress.toLowerCase()

  const { listTokensBatch, delistBatch, approveBatch, clearBatch, removeFromBatch } = batchOps

  const { approvalMap, allApproved, handleDelist, approveCollection } = useUserNfts({
    nfts,
    collections,
    batchOps,
    userAddress,
  })

  const reloadFromSort = useCallback(async () => {
    if (!userAddress) return
    abortControllerRef.current?.abort()
    setIsLoading(true)

    try {
      const data = await UserService.getUserNFTsPaginated(supabase, userAddress, {
        page: 1,
        limit: 24,
        sortBy,
        sortDir,
      })
      setNfts(data.nfts as any)
      setCurrentPage(1)
      setHasMore(data.hasMore)
    } catch (error: any) {
      if (error?.name === "AbortError") return
      console.error("Error reloading NFTs:", error)
    } finally {
      setIsLoading(false)
    }
  }, [userAddress, sortBy, sortDir])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    reloadFromSort()
  }, [sortBy, sortDir, reloadFromSort])

  const loadMore = useCallback(async () => {
    if (!userAddress || isLoading || !hasMore) return

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    setIsLoading(true)

    try {
      const nextPage = currentPage + 1
      const data = await UserService.getUserNFTsPaginated(supabase, userAddress, {
        page: nextPage,
        limit: 24,
        sortBy,
        sortDir,
      })

      setNfts((prev: any) => {
        const existingIds = new Set(prev.map((n: any) => n.token_id))
        return [...prev, ...data.nfts.filter((n: any) => !existingIds.has(n.token_id))]
      })

      setCurrentPage(nextPage)
      setHasMore(data.hasMore)
    } catch (error: any) {
      if (error?.name === "AbortError") return
      console.error("Error loading more NFTs:", error)
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [userAddress, currentPage, isLoading, hasMore, sortBy, sortDir])

  useEffect(() => {
    const el = observerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isLoading && hasMore) loadMore()
      },
      { rootMargin: "200px", threshold: 0.1 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore, isLoading, hasMore])

  useEffect(() => () => abortControllerRef.current?.abort(), [])

  const filteredNFTs = useMemo(() => {
    if (!searchQuery) return nfts
    const q = searchQuery.toLowerCase()
    return nfts.filter((nft: any) => nft.token_id.toString().includes(q))
  }, [nfts, searchQuery])

  const sortedNFTs = useMemo(() => {
    if (!searchQuery) return filteredNFTs

    return [...filteredNFTs].sort((a: any, b: any) => {
      if (sortBy === "id") {
        const diff = BigInt(a.token_id) > BigInt(b.token_id) ? 1 : -1
        return sortDir === "asc" ? diff : -diff
      }
      const ap = a.active_listing?.price ? BigInt(a.active_listing.price) : null
      const bp = b.active_listing?.price ? BigInt(b.active_listing.price) : null
      if (ap === null && bp === null) return 0
      if (ap === null) return 1
      if (bp === null) return -1
      const diff = ap > bp ? 1 : ap < bp ? -1 : 0
      return sortDir === "asc" ? diff : -diff
    })
  }, [filteredNFTs, searchQuery, sortBy, sortDir])

  return (
    <div className="grow flex flex-col min-h-0">
      <div className="flex gap-4 items-center flex-wrap">
        {isOwner && (
          <div className="py-2 flex gap-2 flex-wrap">
            <button
              onClick={() => listTokensBatch.length > 0 && setShowListCard(true)}
              disabled={listTokensBatch.length === 0}
              className={`rounded flex gap-3 py-1 px-6 border border-(--accent) transition-all ${
                listTokensBatch.length > 0 ? "bg-(--accent) text-(--bg-secondary) hover:opacity-90" : "opacity-30 cursor-default"
              }`}
            >
              <span>List</span>
              <span>{listTokensBatch.length}</span>
            </button>

            <button
              onClick={handleDelist}
              disabled={delistBatch.length === 0}
              className={`rounded flex gap-3 py-1 px-6 border border-(--accent) transition-all ${
                delistBatch.length > 0 ? "bg-(--accent) text-(--bg-secondary) hover:opacity-90" : "opacity-30 cursor-default"
              }`}
            >
              <span>Delist</span>
              <span>{delistBatch.length}</span>
            </button>

            {!allApproved && approveBatch.length > 0 && (
              <button onClick={() => approveCollection(approveBatch[0])} className="rounded flex gap-3 py-1 px-6 bg-(--accent) text-(--bg-secondary) hover:opacity-90">
                <span>Approve</span>
                <span>{approveBatch.length}</span>
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-4 ml-auto">
          {(["price", "id"] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                if (sortBy === s) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                else {
                  setSortBy(s)
                  setSortDir("asc")
                }
              }}
              className="py-1 bg-transparent! flex items-center gap-2 text-(--text)! capitalize"
            >
              <span className="text-sm">{s}</span>
              <IoIosArrowDown className={`transition-transform ${sortBy !== s ? "opacity-50" : ""} ${sortBy === s && sortDir === "asc" ? "rotate-180" : ""}`} />
            </button>
          ))}

          <input
            type="text"
            placeholder="Search token ID"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1 rounded border border-(--text)/20 bg-transparent text-sm"
          />
        </div>
      </div>

      {sortedNFTs.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center gap-2 p-8">
          <FaInbox className="text-4xl opacity-50" />
          <p className="text-lg opacity-75">No items found</p>
        </div>
      )}

      <div className="grow min-h-0 overflow-y-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 pr-2">
          {isLoading &&
            sortedNFTs.length === 0 &&
            [...Array(6)].map((_, i) => (
              <div key={i} className="w-full relative flex justify-center aspect-9/12 animate-pulse">
                <div className="absolute w-full h-full bg-(--accent) opacity-20 rounded" />
              </div>
            ))}

          <AnimatePresence>
            {sortedNFTs.map((nft: EnrichedUserNFT, i) => (
              <NFTCard
                key={`${nft.token_id}-${nft.collection_address}`}
                isUserPage={true}
                token={{
                  ...nft,
                  price: nft.active_listing?.price,
                  seller_wallet: nft.active_listing?.seller_wallet,
                  topBid: nft.topBid,
                }}
                approvalMap={approvalMap}
                batchOps={batchOps}
              />
            ))}
          </AnimatePresence>

          {hasMore && (
            <div ref={observerRef} className="w-full h-10 col-span-full flex items-center justify-center">
              {isLoading && <span>Loading more...</span>}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showListCard && (
          <UserListCard
            removeFromBatch={removeFromBatch}
            items={listTokensBatch}
            collections={collections}
            listings={[]}
            onClose={() => setShowListCard(false)}
            onSuccess={() => {
              clearBatch("list")
              setShowListCard(false)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
