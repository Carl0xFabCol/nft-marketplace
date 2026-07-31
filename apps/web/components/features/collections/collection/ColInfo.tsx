"use client"

import { useEffect, useState } from "react"
import { FaEthereum, FaExternalLinkAlt } from "react-icons/fa"
import { FiCopy } from "react-icons/fi"
import { explorerTokenUrl } from "@/lib/chains"
import { supabase } from "@/lib/supabase/client"

interface ColRow {
  name: string | null
  royalty_fee: number | null
  total_volume: number | null
  total_sales: number | null
}

export default function ColInfo({ colAddress }: { colAddress: string }) {
  const [col, setCol] = useState<ColRow | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from("collections")
      .select("name, royalty_fee, total_volume, total_sales")
      .eq("contract_address", colAddress.toLowerCase())
      .single()
      .then(({ data }) => {
        if (!cancelled && data) setCol(data as ColRow)
      })

    return () => {
      cancelled = true
    }
  }, [colAddress])

  const copyToClipboard = (value: string) => {
    navigator.clipboard.writeText(value)
  }

  return (
    <div className="px-4 flex items-center rounded card p-2  w-full">
      <div className="flex items-center gap-4 w-full">
        <h2 className="font-bold text-2xl">{col?.name ? col.name : "-"}</h2>
        <button onClick={() => copyToClipboard(colAddress)} className="bg-transparent! text-(--text)! hover:opacity-75! ml-4">
          <FiCopy className=" text-xl" />
        </button>
        <a href={explorerTokenUrl(colAddress)} target="_blank">
          <FaExternalLinkAlt className="hover:opacity-75 hover:cursor-pointer text-[17px]" />
        </a>
        <div className="flex items-center ">
          <div className="rounded card px-2 py-1 border text-xs">{col?.royalty_fee != null ? col.royalty_fee / 100 : "-"}%</div>
        </div>
        <div className="flex items-center w-full px-5 gap-5">
          <div className="card py-2 px-4 rounded-xl border-2 border-(--bg) flex flex-col">
            <span className="font-bold text-xs opacity-75">TOTAL VOLUME</span>
            <div className="flex gap-1 items-center justify-center">
              <span>{col?.total_volume != null ? col.total_volume : "-"}</span>
              <FaEthereum />
            </div>
          </div>
          <div className="card py-2 px-4 rounded-xl border-2 border-(--bg) flex flex-col text-center">
            <span className="font-bold text-xs opacity-75">TOTAL SALES</span>
            <span>{col?.total_sales != null ? col.total_sales : "-"}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
