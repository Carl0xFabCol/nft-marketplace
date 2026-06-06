"use client"
import { WagmiProvider, createConfig, http } from "wagmi"
import { sepolia, mainnet } from "wagmi/chains"
import { injected } from "wagmi/connectors"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { AuthProvider } from "@/components/AuthProvider"
import { TxProvider } from "./context/TxContext"
import Header from "@/components/Header"
import { FaTimes } from "react-icons/fa"
import { WalletOptions } from "./WalletOptions"

const config = createConfig({
  chains: [sepolia, mainnet],
  connectors: [injected()],

  transports: {
    [sepolia.id]: http(),
    [mainnet.id]: http(),
  },
})

const queryClient = new QueryClient()

export function Providers({ children }: { children: React.ReactNode }) {
  const [walletOptionsCard, setWalletModal] = useState<boolean>(false)

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TxProvider>
            <Header openWalletModal={() => setWalletModal(true)} />
            {walletOptionsCard && (
              <div
                id="woc-bg"
                onClick={(e: any) => {
                  if (e.target.id == "woc-bg") {
                    setWalletModal(false)
                  }
                }}
                className="absolute w-full bg-[#0000006b] bottom-0 left-0 h-full flex items-center justify-center z-200"
              >
                <div className="bg-(--bg-secondary) min-w-[30%] gap-2 border border-(--text)/20 rounded-2xl p-4 flex flex-col  ">
                  <div className="flex w-full items-center justify-between pb-2">
                    <h2 className="text-sm">Connect wallet</h2>
                    <button onClick={() => setWalletModal(false)} className="bg-transparent! text-(--text)!">
                      <FaTimes />
                    </button>
                  </div>
                  <WalletOptions onConnect={() => setWalletModal(false)} />
                </div>
              </div>
            )}
            <main className="flex flex-col grow min-h-0 items-center  overflow-scroll">{children}</main>
            <footer className=" bg-(--bg) fixed  bottom-0  w-full flex items-center justify-between border-t border-(--text)/20 text-xs mt-auto text-center z-50">
              <div className="flex px-4 items-center gap-2">
                <div className="flex gap-1 items-center">
                  <div className="p-0.5 rounded-full bg-radial animate-pulse from-[#80ff80] to-transparent !">
                    <div className="p-0.5 rounded-full  bg-[#44ef44] "></div>
                  </div>
                  <span className="text-[#44ef44]">ONLINE</span>
                </div>
                <div className="p-2 px-4   rounded-xl ">
                  <span>SYSTEM: </span>
                  <span className="text-[#fbc053]">BETA</span>
                </div>
              </div>
              <span className="px-4">Built with Next.js, Wagmi, Viem, Foundry & Love {"<3"}</span>
            </footer>
          </TxProvider>
        </AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
