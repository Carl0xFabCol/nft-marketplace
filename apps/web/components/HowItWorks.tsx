"use client"

import { FaTimes } from "react-icons/fa"

export default function HowItWorks() {
  return (
    <div id="hiw_bg" className="fixed inset-0 bg-black/50 flex items-center justify-center z-500">
      <div className=" border card border-(--accent)/30! rounded  text-sm relative">
        <div className=" rounded bg-(--accent)/20  p-4">
          <h3 className="text-lg font-semibold mb-4">How it works</h3>

          <ol className="space-y-2 list-decimal list-inside">
            <li>Connect your wallet on Sepolia.</li>
            <li>Select the amount of NFTs to mint.</li>
            <li>Confirm the transaction in your wallet.</li>
            <li>Wait for on-chain confirmation.</li>
            <li>Now you can burn your NFTs to recover your testnet ETH.</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
