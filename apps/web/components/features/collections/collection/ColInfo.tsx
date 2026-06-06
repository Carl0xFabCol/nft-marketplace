"use client"

import { MarketplaceABI } from "@/lib/abi"
import { MARKETPLACE_CONTRACT_ADDRESS } from "@/lib/constants"
import { useEffect, useState } from "react"
import { FaEthereum, FaExternalLinkAlt } from "react-icons/fa"
import { FiCopy } from "react-icons/fi"
import { Address, erc721Abi } from "viem"
import { useReadContract } from "wagmi"

export default function ColInfo({ colAddress }: { colAddress: string }) {
  const [collectionSelected, setCollectionSelected] = useState<Address | string>(colAddress)

  const { data: colData } = useReadContract({
    address: MARKETPLACE_CONTRACT_ADDRESS as `0x${string}`,
    abi: MarketplaceABI,
    functionName: "collections",
    args: [collectionSelected as `0x${string}`],
  })

  const { data: colName } = useReadContract({
    address: collectionSelected as `0x${string}`,
    abi: erc721Abi,
    functionName: "name",
  })

  useEffect(() => {
    setCollectionSelected(colAddress)
  }, [])

  const copyToClipboard = (value: string) => {
    navigator.clipboard.writeText(value)
  }

  return (
    <div className="px-4 flex items-center rounded card p-2  w-full">
      <div className="flex items-center gap-4 w-full">
        <h2 className="font-bold text-2xl">{colName ? colName : "-"}</h2>
        <button onClick={() => copyToClipboard(collectionSelected)} className="bg-transparent! text-(--text)! hover:opacity-75! ml-4">
          <FiCopy className=" text-xl" />
        </button>
        <a href={`https://sepolia.etherscan.io/token/${collectionSelected}`} target="_blank">
          <FaExternalLinkAlt className="hover:opacity-75 hover:cursor-pointer text-[17px]" />
        </a>
        <div className="flex items-center ">
          <div className="rounded card px-2 py-1 border text-xs">{colData ? Number(colData.royaltyFee) / 100 : "-"}%</div>
        </div>
        <div className="flex items-center w-full px-5 gap-5">
          <div className="card py-2 px-4 rounded-xl border-2 border-(--bg) flex flex-col">
            <span className="font-bold text-xs opacity-75">TOTAL VOLUME</span>
            <div className="flex gap-1 items-center justify-center">
              <span>{colData ? Number(colData.totalVolume) / 1e18 : "-"}</span>
              <FaEthereum />
            </div>
          </div>
          <div className="card py-2 px-4 rounded-xl border-2 border-(--bg) flex flex-col text-center">
            <span className="font-bold text-xs opacity-75">TOTAL SALES</span>
            <span>{colData ? colData.totalSales : "-"}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
