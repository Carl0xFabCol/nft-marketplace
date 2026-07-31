"use client"

import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { FaUsers, FaGavel, FaSearch } from "react-icons/fa"
import { HiOutlineCollection } from "react-icons/hi"
import { IoIosArrowDown } from "react-icons/io"
import { useAccount } from "wagmi"
import { erc721Abi, Address } from "viem"
import { useReadContract } from "wagmi"
import { NFTCard } from "@/components/features/nft/NftCard"
import CollectionBids from "./CollectionBids"
import { BuyCard } from "./BuyCard"
import { BidCard } from "./BidCard"
import { ColBidCard } from "./ColBidCard"
import { useBatchOperations } from "@/hooks/useBatchOperations"
import { useRealtimeListings } from "@/hooks/useRealtimeListings"
import { upsertListingIntoNfts, deactivateListingInNfts } from "@/lib/listingMerge"
import { SortBy, SortDir } from "@/lib/constants"
import { NFTService } from "@/services/nft.service"
import { UserListing } from "@/types/user.types"

interface CollectionClientAreaProps {
  colAddress: Address
  collectionBids: any[]
  initialNftsData: {
    nfts: any[]
    page: number
    limit: number
    total: number
    totalPages: number
    hasMore: boolean
  }
  initialFloorPrice: string
}

export default function CollectionClientArea({ colAddress, collectionBids, initialNftsData, initialFloorPrice }: CollectionClientAreaProps) {
  const [showColBidCard, setShowColBidCard] = useState(false)
  const [showBidCard, setShowBidCard] = useState(false)
  const [showBuyCard, setShowBuyCard] = useState(false)
  const [collectionCard, setCollectionCard] = useState<"items" | "bids" | "holders">("items")
  const [sortBy, setSortBy] = useState<SortBy>("price")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [searchQuery, setSearchQuery] = useState("")
  const [nfts, setNfts] = useState(initialNftsData.nfts)
  const [onlyListed, setOnlyListed] = useState(false)
  const [currentPage, setCurrentPage] = useState(initialNftsData.page)
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(initialNftsData.hasMore)

  // ─── Realtime: reflect indexer writes (sale, delist, price change) live ───
  const handleUpsertListing = useCallback((listing: UserListing) => {
    setNfts((prev) => upsertListingIntoNfts(prev, listing))
  }, [])

  const handleDeactivateListing = useCallback((listing: UserListing) => {
    setNfts((prev) => deactivateListingInNfts(prev, listing))
  }, [])

  useRealtimeListings({
    collectionAddress: colAddress,
    onUpsert: handleUpsertListing,
    onDeactivate: handleDeactivateListing,
  })

  // Usamos useAccount en lugar de useConnection (hook correcto de wagmi v2)
  const { address } = useAccount()
  const abortControllerRef = useRef<AbortController | null>(null)
  const observerRef = useRef<HTMLDivElement | null>(null)
  const isFirstRender = useRef(true)

  const batchOps = useBatchOperations()

  const { data: colName } = useReadContract({
    address: colAddress,
    abi: erc721Abi,
    functionName: "name",
  })

  // floor_price viene del servidor — solo se recalcula si los filtros cambian
  // y el servidor ya no tiene el dato actualizado (edge case). Para el caso
  // normal, usamos el valor de DB que el trigger mantiene al día.
  const floorPrice = useMemo(() => {
    // Si hay NFTs cargados con listings, calculamos desde ellos para reflejar
    // el estado actual de la página (puede diferir si se hizo una venta reciente)
    const prices = nfts.map((nft: any) => (nft.active_listing?.price ? BigInt(nft.active_listing.price) : null)).filter((p): p is bigint => p !== null)

    if (!prices.length) return BigInt(initialFloorPrice)
    return prices.reduce((min, price) => (price < min ? price : min))
  }, [nfts, initialFloorPrice])

  const updateNFTAfterBuy = useCallback(
    (tokenIds: string[]) => {
      batchOps.clearAllBatches()
      setNfts((prev) => prev.map((nft) => (tokenIds.includes(nft.token_id.toString()) ? { ...nft, active_listing: null, owner_wallet: address } : nft)))
    },
    [address, batchOps],
  )

  // Carga de primera página — solo cuando cambian los filtros, NO en el mount inicial
  // porque initialNftsData ya viene con la primera página desde el servidor.
  const loadFirstPage = useCallback(async () => {
    abortControllerRef.current?.abort()
    setIsLoading(true)

    try {
      const data = await NFTService.getCollectionNFTs(colAddress, {
        page: 1,
        limit: 24,
        onlyListed,
        sortBy,
        sortDir,
      })

      setNfts(data.nfts)
      setCurrentPage(1)
      setHasMore(data.hasMore)
    } catch (error: any) {
      if (error?.name === "AbortError") return
      console.error("Error loading first page:", error)
    } finally {
      setIsLoading(false)
    }
  }, [colAddress, onlyListed, sortBy, sortDir])

  // Evitar la carga doble en el mount inicial
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    loadFirstPage()
  }, [onlyListed, sortBy, sortDir, loadFirstPage])

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    setIsLoading(true)

    try {
      const nextPage = currentPage + 1
      const data = await NFTService.getCollectionNFTs(colAddress, {
        page: nextPage,
        limit: 24,
        onlyListed,
        sortBy,
        sortDir,
      })

      setNfts((prev) => {
        const existingIds = new Set(prev.map((nft) => nft.token_id))
        const newNfts = data.nfts.filter((nft: any) => !existingIds.has(nft.token_id))
        return [...prev, ...newNfts]
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
  }, [colAddress, currentPage, isLoading, hasMore, onlyListed, sortBy, sortDir])

  // Intersection Observer para infinite scroll
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

  // Cleanup al desmontar
  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  // Filtrado local por búsqueda (solo sobre los NFTs ya cargados)
  const filteredNFTs = useMemo(() => {
    if (!searchQuery) return nfts
    const q = searchQuery.toLowerCase()
    return nfts.filter((nft: any) => nft.token_id.toString().includes(q) || nft.metadata?.name?.toLowerCase().includes(q) || nft.collection_address.toLowerCase() === q)
  }, [nfts, searchQuery])

  // Reordenamiento local solo cuando hay búsqueda activa
  // (sin búsqueda el servidor ya devuelve los datos ordenados)
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
    <div>
      <div className="flex card rounded flex-col px-4">
        {/* Tabs */}
        <div className="flex items-center border-b border-(--text)/20">
          {(["items", "bids", "holders"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setCollectionCard(tab)}
              className={`
                bg-transparent! flex items-center gap-2 px-4 py-3 border-b-2 transition-all capitalize
                ${collectionCard === tab ? "text-(--accent)! border-(--accent)" : "border-transparent text-(--text)/50! hover:text-(--accent)/50!"}
              `}
            >
              {tab === "items" && <HiOutlineCollection />}
              {tab === "bids" && <FaGavel />}
              {tab === "holders" && <FaUsers />}
              <span>{tab}</span>
            </button>
          ))}
        </div>

        {/* Controles */}
        {collectionCard === "items" && (
          <div className="flex w-full justify-between items-center py-2 gap-4">
            <div className="flex gap-4 items-center">
              <button
                onClick={() => setShowBuyCard(true)}
                disabled={!batchOps.buyBatch.length}
                className={`flex items-center py-1 gap-3 px-6 rounded border border-(--accent) ${batchOps.buyBatch.length ? "bg-(--accent) text-(--bg-secondary)" : "opacity-30 hover:opacity-30!"}`}
              >
                <span>Buy</span>
                <span>{batchOps.buyBatch.length}</span>
              </button>

              <button
                onClick={() => setShowBidCard(true)}
                disabled={!batchOps.bidBatch.length}
                className={`flex items-center py-1 gap-3 px-6 rounded border border-(--accent) ${batchOps.bidBatch.length ? "bg-(--accent) text-(--bg-secondary)" : "opacity-30 hover:opacity-30!"}`}
              >
                <FaGavel />
                <span>Bid</span>
                <span>{batchOps.bidBatch.length}</span>
              </button>

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={onlyListed} onChange={(e) => setOnlyListed(e.target.checked)} className="w-4 h-4" />
                <span className="text-sm">Only listed</span>
              </label>

              <div className="flex items-center gap-4">
                {(["price", "id"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      if (sortBy === s) {
                        setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                      } else {
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
              </div>

              <label className="flex gap-2 items-center px-3 py-1">
                <FaSearch className="opacity-65" />
                <input type="text" placeholder="Search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="p-1 bg-transparent! w-full" />
              </label>
            </div>

            <button onClick={() => setShowColBidCard(true)} className="rounded px-5 py-1 flex items-center bg-(--accent) text-(--bg-secondary) gap-2 hover:opacity-90">
              <FaGavel />
              <span>Place collection bid</span>
            </button>
          </div>
        )}

        {/* Contenido */}
        {collectionCard === "items" && (
          <div>
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-4 pb-4">
              <AnimatePresence>
                {sortedNFTs.map((nft: any) => (
                  <NFTCard
                    key={`${nft.token_id}-${nft.collection_address}`}
                    token={{
                      ...nft,
                      price: nft.active_listing?.price,
                      seller_wallet: nft.active_listing?.seller_wallet,
                      topBid: nft.topBid,
                    }}
                    batchOps={batchOps}
                  />
                ))}
              </AnimatePresence>
            </div>

            {hasMore && (
              <div ref={observerRef} className="w-full h-10 flex items-center justify-center">
                {isLoading && <span>Loading more...</span>}
              </div>
            )}

            {!hasMore && nfts.length > 0 && <p className="text-center py-4 opacity-50">No more NFTs to load</p>}
          </div>
        )}

        {collectionCard === "bids" && <CollectionBids collectionBids={collectionBids} />}

        {collectionCard === "holders" && (
          <div className="py-8 text-center opacity-50">
            <p>Holders view coming soon</p>
          </div>
        )}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showBuyCard && (
          <BuyCard
            items={batchOps.buyBatch}
            collectionName={colName as string}
            onClose={() => setShowBuyCard(false)}
            onSuccess={(tokenIds: string[]) => updateNFTAfterBuy(tokenIds)}
            onRemoveItem={(item) => batchOps.removeFromBatch(item, "buy")}
          />
        )}

        {showBidCard && (
          <BidCard
            items={batchOps.bidBatch}
            collectionAddress={colAddress}
            collectionName={colName as string}
            onClose={() => setShowBidCard(false)}
            onSuccess={() => batchOps.clearBatch("bid")}
            onRemoveItem={(item) => batchOps.removeFromBatch(item, "bid")}
          />
        )}

        {showColBidCard && <ColBidCard collectionAddress={colAddress} floorPrice={floorPrice} onClose={() => setShowColBidCard(false)} />}
      </AnimatePresence>
    </div>
  )
}
