"use client"

import { createContext, useContext, useState } from "react"
import { FaTimes } from "react-icons/fa"
import { Address } from "viem"
import { RxCrossCircled } from "react-icons/rx"
import { FiCheckCircle } from "react-icons/fi"

export type TxItem = {
  hash?: `0x${string}`
  status: "waiting" | "loading" | "success" | "error"
  label?: string
}

type TxContextType = {
  txs: TxItem[]
  addTx: (tx: TxItem) => void
  updateTx: (hash: string, patch: Partial<TxItem>) => void
  removeTx: (txHash: Address) => void
}

const TxContext = createContext<TxContextType | null>(null)

export function TxProvider({ children }: { children: React.ReactNode }) {
  const [txs, setTxs] = useState<TxItem[]>([])

  const addTx = (tx: TxItem) => {
    setTxs((prev) => [tx, ...prev])
  }

  const updateTx = (hash: string, patch: Partial<TxItem>) => {
    setTxs((prev) => prev.map((tx) => (tx.hash === hash ? { ...tx, ...patch } : tx)))
  }

  const removeTx = (txHash: Address | undefined) => {
    setTimeout(() => {
      setTxs(() => txs.filter((tx) => tx.hash?.toLowerCase() != txHash?.toLowerCase()))
    }, 3500)
  }

  return (
    <TxContext.Provider value={{ txs, addTx, updateTx, removeTx }}>
      {children}
      {txs.length >= 0 && (
        <div className="fixed flex flex-col gap-2 right-3 bottom-11 z-50">
          {txs.map((tx: TxItem) => {
            return (
              <div key={tx.hash} className="rounded-xl text-xs! lg:text-sm! flex flex-col gap-2 border border-(--text)/20 card p-4 overflow-hidden">
                <div className="flex items-center gap-4  w-full justify-between  text-(--text)">
                  <span className="font-bold ">{tx.label}</span>
                  <button onClick={() => removeTx(tx.hash)} className="bg-transparent! text-(--text)!">
                    <FaTimes />
                  </button>
                </div>
                <div className="flex items-center gap-3  ">
                  {tx.status === "loading" && (
                    <svg className=" w-2 h-2 lg:w-4 lg:h-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="20" strokeLinecap="round" />
                    </svg>
                  )}
                  {tx.status === "success" && <FiCheckCircle className="text-[#6dfa6d] w-2 h-2 lg:w-4 lg:h-4" />}
                  {tx.status === "error" && <RxCrossCircled className="text-red-500 w-2 h-2 lg:w-4 lg:h-4" />}
                  <a target="_blank" href={`https://sepolia.etherscan.io/tx/${tx.hash}`} className="hover:opacity-75 ">
                    {tx.hash?.slice(0, 6)}...{tx.hash?.slice(-6)}
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </TxContext.Provider>
  )
}

export const useTx = () => {
  const ctx = useContext(TxContext)
  if (!ctx) throw new Error("useTx must be used inside TxProvider")
  return ctx
}
