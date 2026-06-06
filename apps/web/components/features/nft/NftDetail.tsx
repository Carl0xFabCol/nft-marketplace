"use client"

import { useState } from "react"
import { FaEthereum, FaHeart, FaShareAlt } from "react-icons/fa"
import { NFTHistory } from "./NftHistory"
import { NFTProperties } from "./NftProperties"
import { NFTActions } from "./NftActions"
import NFTBids from "./NftBids"
import { useConnection } from "wagmi"

interface NFTDetailProps {
  nft: any
  isModal?: boolean // 👈 Cambia el comportamiento según contexto
}

export default function NFTDetail({ nft, isModal = false }: NFTDetailProps) {
  const [activeTab, setActiveTab] = useState<"details" | "history" | "properties" | "bids">("details")
  const { address } = useConnection()

  return (
    <div
      className={`
        p-2
        rounded card
      flex flex-col lg:flex-row gap-6 w-full
     
    `}
    >
      {/* Imagen del NFT */}
      <div
        className={`
        lg:w-1/2
        rounded-2xl overflow-hidden border border-(--text)/20 aspect-square h-min
      `}
      >
        <img src={nft.image_url || "/placeholder-nft.png"} alt={nft.name} className="w-full aspect-square object-cover" />
      </div>

      {/* Detalles del NFT */}
      <div
        className={`
        ${isModal ? "lg:flex-1" : "lg:w-1/2"}
        flex flex-col gap-4
      `}
      >
        {/* Header */}
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">{nft.metadata.name}</h1>
        </div>

        {/* Owner */}
        <div className="flex items-center gap-2">
          <span className="opacity-75">Owned by</span>
          <a href={`/user/${nft.owner_wallet}`} className="font-bold hover:text-(--accent)">
            {nft.ownerName || `${nft.owner_wallet.slice(0, 6)}...${nft.owner_wallet.slice(-4)}`}
          </a>
        </div>

        {/* Price / Actions */}
        <NFTActions nft={nft} />

        {/* Tabs */}
        <div className="flex border-b border-(--text)/20">
          <button
            onClick={() => setActiveTab("details")}
            className={`px-4 py-2 border-b-2 bg-transparent! ${activeTab === "details" ? "border-(--accent) text-(--accent)!" : "border-transparent text-(--text)!"}`}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab("properties")}
            className={`px-4 py-2 border-b-2 bg-transparent! ${activeTab === "properties" ? "border-(--accent) text-(--accent)!" : "border-transparent text-(--text)!"}`}
          >
            Properties
          </button>
          <button
            onClick={() => setActiveTab("bids")}
            className={`px-4 py-2 border-b-2 bg-transparent! ${activeTab === "bids" ? "border-(--accent) text-(--accent)!" : "border-transparent text-(--text)!"}`}
          >
            Bids
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-2 border-b-2 bg-transparent! ${activeTab === "history" ? "border-(--accent) text-(--accent)!" : "border-transparent text-(--text)!"}`}
          >
            History
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1">
          {activeTab === "details" && (
            <div className="flex flex-col gap-2">
              <p className="opacity-75">{nft.description}</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="opacity-75">Contract:</span>
                  <a href={`https://etherscan.io/address/${nft.collection}`} target="_blank" className="font-mono hover:text-(--accent)">
                    {nft.collection_address.slice(0, 6)}...{nft.collection_address.slice(-4)}
                  </a>
                </div>
                <div>
                  <span className="opacity-75">Token ID:</span>
                  <span className="font-bold">{nft.token_id}</span>
                </div>
              </div>
            </div>
          )}
          {activeTab === "properties" && <NFTProperties nft={nft} />}

          {activeTab === "bids" && <NFTBids bids={nft.bids} owner={address?.toLowerCase() == nft.owner_wallet} />}
          {activeTab === "history" && <NFTHistory nft={nft} />}
        </div>
      </div>
    </div>
  )
}
