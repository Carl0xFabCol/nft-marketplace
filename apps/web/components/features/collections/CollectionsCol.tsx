// components/features/collections/CollectionsCol.tsx
"use client"

import { useReadContracts, useReadContract } from "wagmi"
import { erc721Abi } from "viem"
import { useMemo } from "react"
import Link from "next/link"
import { FaEthereum } from "react-icons/fa"
import { MARKETPLACE_CONTRACT_ADDRESS } from "@/lib/constants"
import { MarketplaceABI } from "@/lib/abi"
import { Collection } from "@/services/collections.service"

interface CollectionsColProps {
  collections: Collection[]
}

export default function CollectionsCol({ collections }: CollectionsColProps) {
  console.log(collections)

  const { data: marketplaceData } = useReadContracts({
    contracts: collections.map(
      (col: Collection) =>
        ({
          address: MARKETPLACE_CONTRACT_ADDRESS,
          abi: MarketplaceABI,
          functionName: "collections",
          args: [col.contract_address],
        }) as any,
    ),
    query: {
      enabled: Boolean(collections.length),
    },
  })

  // Obtener nombres de las colecciones
  const { data: namesData }: any = useReadContracts({
    contracts: collections.map((col: Collection) => ({
      address: col.contract_address,
      abi: erc721Abi,
      functionName: "name",
    })),
    query: {
      enabled: Boolean(collections.length),
    },
  })

  // Obtener total supply de las colecciones
  const { data: totalSupplyData }: any = useReadContracts({
    contracts: collections.map((col: Collection) => ({
      address: col.contract_address,
      abi: erc721Abi,
      functionName: "totalSupply",
    })),
    query: {
      enabled: Boolean(collections.length),
    },
  })

  // Mapa de datos del marketplace
  const marketplaceMap = useMemo<Record<string, any>>(() => {
    if (!marketplaceData?.length) return {}

    const map: Record<string, any> = {}

    collections.forEach((col: Collection, i: number) => {
      const res = marketplaceData[i]
      if (res?.result) {
        map[String(col.contract_address).toLowerCase()] = res.result
      }
    })

    return map
  }, [marketplaceData, collections])

  // Mapa de nombres
  const namesMap = useMemo<Record<string, string>>(() => {
    if (!namesData?.length) return {}

    const map: Record<string, string> = {}

    collections.forEach((col: Collection, i: number) => {
      const res = namesData[i]
      if (res?.result) {
        map[String(col.contract_address).toLowerCase()] = res.result as string
      }
    })

    return map
  }, [namesData, collections])

  // Mapa de total supplies
  const totalSuppliesMap = useMemo<Record<string, string>>(() => {
    if (!totalSupplyData?.length) return {}

    const map: Record<string, string> = {}

    collections.forEach((col: Collection, i: number) => {
      const res = totalSupplyData[i]
      if (res?.result) {
        map[String(col.contract_address).toLowerCase()] = res.result as string
      }
    })

    return map
  }, [totalSupplyData, collections])

  // Si no hay colecciones, mostrar mensaje
  if (!collections.length) {
    return (
      <div className="flex flex-col w-full text-(--text)! card rounded-b p-8 text-center">
        <p className="opacity-50">No collections found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col w-full text-(--text)! card rounded-b">
      {collections.map((collection: Collection) => {
        const address = collection.contract_address.toLowerCase()
        const name = namesMap[address] || collection.name || "-"
        const marketplaceData = marketplaceMap[address]

        const floorFromDB = collection.floor_price ? Number(collection.floor_price) / 1e18 : null

        // Top bid

        // Royalty fee (prioridad: del marketplace > de la DB)
        const royaltyFromMarketplace = marketplaceData?.royaltyFee ? Number(marketplaceData.royaltyFee) / 100 : null
        const royaltyFromDB = collection.royalty_fee ? collection.royalty_fee / 100 : null
        const royaltyFee = royaltyFromMarketplace !== null ? royaltyFromMarketplace : royaltyFromDB !== null ? royaltyFromDB : "-"

        // Total volume (prioridad: del marketplace > de la DB)
        const volumeFromDB = collection.total_volume ? Number(collection.total_volume) : null
        const totalVol = volumeFromDB !== null ? volumeFromDB : "-"

        // Total supply
        const supplyFromContract = totalSuppliesMap[address] ? totalSuppliesMap[address] : null
        const supply = supplyFromContract || collection.nft_count || "-"

        return (
          <Link href={`/collection/${collection.contract_address}`} key={collection.contract_address} className="flex group justify-between items-center w-full p-2">
            <div className="flex justify-between items-center w-full p-2 transition-all duration-200 group-hover:bg-(--accent)/20 rounded">
              {/* Collection info */}
              <div className="flex flex-2 flex-col">
                <div className="flex items-center gap-2">
                  {collection.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={collection.image_url} alt={name} className="w-6 h-6 rounded-full object-cover" />
                  )}
                  <span className="font-medium truncate max-w-[150px]">{name}</span>
                  {collection.is_verified && <span className="text-blue-400 text-xs">✓</span>}
                </div>
                <span className="text-xs opacity-50">{collection.symbol}</span>
              </div>

              {/* Floor price */}
              <div className="flex flex-1 items-center gap-1">
                {floorFromDB !== null && floorFromDB.toString() !== "-" ? (
                  <>
                    <span>{typeof floorFromDB === "number" ? floorFromDB.toFixed(3) : floorFromDB}</span>
                    <FaEthereum className="text-xs" />
                  </>
                ) : (
                  <span>-</span>
                )}
              </div>

              {/* Top bid */}
              <div className="flex flex-1 items-center gap-1">
                {null !== "-" ? (
                  <>
                    <span>{"-"}</span>
                    <FaEthereum className="text-xs" />
                  </>
                ) : (
                  <span>-</span>
                )}
              </div>

              {/* Royalty fee */}
              <div className="flex flex-1">
                <span>{royaltyFee !== "-" ? `${royaltyFee}%` : "-"}</span>
              </div>

              {/* Total volume */}
              <div className="flex flex-1 items-center gap-1">
                {totalVol !== "-" ? (
                  <>
                    <span>{totalVol}</span>
                    <FaEthereum className="text-xs" />
                  </>
                ) : (
                  <span>-</span>
                )}
              </div>

              {/* Supply */}
              <div className="flex flex-1">
                <span>{supply}</span>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
