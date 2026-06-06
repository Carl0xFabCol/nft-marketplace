"use client"
import { useMemo } from "react"
import { FaTag } from "react-icons/fa"

interface NFTPropertiesProps {
  nft: {
    metadata?: {
      attributes?: Array<{
        trait_type: string
        value: string | number
      }>
    }
    collection?: {
      total_supply?: number
    }
  }
}

export function NFTProperties({ nft }: NFTPropertiesProps) {
  const attributes = nft.metadata?.attributes || []

  // Calcular rareza de cada atributo (si tienes los datos)
  const attributesWithRarity = useMemo(() => {
    return attributes.map((attr) => {
      // TODO: Calcular rareza real desde tu DB
      // Por ahora, valor simulado
      const rarity = Math.floor(Math.random() * 100)

      return {
        ...attr,
        rarity,
        rarityLabel: rarity < 10 ? "Legendary" : rarity < 25 ? "Epic" : rarity < 50 ? "Rare" : rarity < 75 ? "Uncommon" : "Common",
      }
    })
  }, [attributes])

  if (attributes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 opacity-50">
        <FaTag className="text-4xl mb-2" />
        <p>No properties available</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {attributesWithRarity.map((attr, index) => (
        <div key={index} className="card rounded-lg p-4 border border-(--text)/20 hover:border-(--accent) transition-all cursor-pointer">
          {/* Trait type */}
          <div className="text-xs opacity-75 uppercase mb-1">{attr.trait_type}</div>

          {/* Value */}
          <div className="font-bold text-lg mb-2 break-words">{attr.value}</div>

          {/* Rarity */}
          <div className="flex items-center justify-between text-xs">
            <span
              className={`
              px-2 py-0.5 rounded
              ${attr.rarityLabel === "Legendary" ? "bg-yellow-500/20 text-yellow-500" : ""}
              ${attr.rarityLabel === "Epic" ? "bg-purple-500/20 text-purple-500" : ""}
              ${attr.rarityLabel === "Rare" ? "bg-blue-500/20 text-blue-500" : ""}
              ${attr.rarityLabel === "Uncommon" ? "bg-green-500/20 text-green-500" : ""}
              ${attr.rarityLabel === "Common" ? "bg-gray-500/20 text-gray-500" : ""}
            `}
            >
              {attr.rarityLabel}
            </span>
            <span className="opacity-50">{attr.rarity}% have this</span>
          </div>
        </div>
      ))}
    </div>
  )
}
