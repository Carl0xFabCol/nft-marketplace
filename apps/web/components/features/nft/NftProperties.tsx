"use client"
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
      {attributes.map((attr, index) => (
        <div key={index} className="card rounded-lg p-4 border border-(--text)/20 hover:border-(--accent) transition-all cursor-pointer">
          {/* Trait type */}
          <div className="text-xs opacity-75 uppercase mb-1">{attr.trait_type}</div>

          {/* Value */}
          <div className="font-bold text-lg mb-2 break-words">{attr.value}</div>
        </div>
      ))}
    </div>
  )
}
