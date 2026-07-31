// components/TopCollectionsSlider.tsx
"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { FiChevronLeft, FiChevronRight, FiImage } from "react-icons/fi"
import { Collection } from "@/types/user.types"

interface TopCollectionsSliderProps {
  collections: Collection[]
}

export function TopCollectionsSlider({ collections }: TopCollectionsSliderProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [imagesError, setImagesError] = useState<Record<string, boolean>>({})

  const itemsPerView = 1 // Número de colecciones visibles por slide

  const handleImageError = (contractAddress: string) => {
    setImagesError((prev) => ({ ...prev, [contractAddress]: true }))
  }

  const nextSlide = () => {
    if (currentIndex < collections.length - itemsPerView) {
      setCurrentIndex((prev) => prev + 1)
    }
  }

  const prevSlide = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1)
    }
  }

  const formatVolume = (volume: number | null) => {
    if (!volume) return "0 ETH"
    return `${volume.toFixed(3)} ETH`
  }

  if (collections.length === 0) {
    return (
      <div className="w-full py-8">
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-8 text-center">
          <p className="text-yellow-800 dark:text-yellow-200">No collections available yet</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full flex flex-col items-center">
      <div className="absolute z-10 w-full top-[170px]">
        {collections.length > itemsPerView && (
          <div className="flex items-center justify-between px-2">
            <button
              onClick={prevSlide}
              disabled={currentIndex === 0}
              className="p-2 rounded-full text-(--accent)! bg-transparent!  disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              aria-label="Previous slide"
            >
              <FiChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={nextSlide}
              disabled={currentIndex >= collections.length - itemsPerView}
              className="p-2 rounded-full  text-(--accent)! bg-transparent! disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              aria-label="Next slide"
            >
              <FiChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      <div className="relative overflow-hidden w-full bg-white">
        <div
          className="flex transition-transform duration-300 ease-in-out "
          style={{
            transform: `translateX(-${currentIndex * (100 / itemsPerView)}%)`,
          }}
        >
          {collections.map((collection, index) => (
            <Link key={collection.id} href={`/collection/${collection.contract_address}`} className="flex-none w-full  " style={{ flex: `0 0 ${100 / itemsPerView}%` }}>
              <div className="card    transition-all  group relative">
                {/* Rank Badge */}
                <div className="relative">
                  {/* Collection Image */}
                  <div className="relative w-full h-68 bg-gray-100 dark:bg-gray-800  overflow-hidden">
                    {collection.image_url && !imagesError[collection.contract_address] ? (
                      <Image
                        src={collection.image_url}
                        alt={collection.name || collection.symbol || "Collection"}
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={() => handleImageError(collection.contract_address)}
                      />
                    ) : (
                      <div className="w-full h-full relative z-1 flex items-center justify-center ">
                        <FiImage className="w-12 h-12 text-gray-400 dark:text-gray-600" />
                      </div>
                    )}

                    {/* Verified Badge */}
                    {collection.is_verified && (
                      <div className="absolute top-2 right-2 bg-blue-500 text-white p-1 rounded-full">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Collection Info */}
                  {/* Collection Info */}
                  <div className="p-4 flex absolute bottom-0 left-0 right-0 flex-col gap-2 z-10 bg-linear-to-t from-black/30 to-transparent">
                    <h3 className="font-semibold text-white mb-1">{collection.name || collection.symbol || "Unknown"}</h3>

                    <div className="flex gap-4 items-center">
                      <div className="flex card p-2 rounded gap-2 flex-col text-sm border border-(--text)/20 items-center">
                        <span className="text-gray-300">Total Volume</span>
                        <span className="font-medium text-white">{formatVolume(collection.total_volume)}</span>
                      </div>

                      <div className="flex card p-2 rounded gap-2 flex-col text-sm border border-(--text)/20 items-center">
                        <span className="text-gray-300">Market Cap</span>
                        <span className="font-medium text-white">
                          {((Number(collection.nft_count?.toLocaleString()) || 0) * (collection.floor_price ? Number(collection.floor_price) : 0)) / 1e18} ETH
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Dots Indicator */}
      {collections.length > itemsPerView && (
        <div className="flex justify-center card p-2 w-full gap-1">
          {Array.from({ length: Math.ceil(collections.length / itemsPerView) }).map((_, i) => {
            const dotIndex = i * itemsPerView
            return (
              <button
                key={i}
                onClick={() => setCurrentIndex(dotIndex)}
                className={`w-2 h-2 rounded-full transition-all ${currentIndex === dotIndex ? "w-6 bg-blue-500" : "bg-gray-300 dark:bg-gray-700 hover:bg-gray-400 dark:hover:bg-gray-600"}`}
                aria-label={`Go to slide ${i + 1}`}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
