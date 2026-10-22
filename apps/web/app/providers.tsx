"use client"
import { WagmiProvider, createConfig, http } from "wagmi"
import { sepolia } from "wagmi/chains"
import { injected } from "wagmi/connectors"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { AuthProvider } from "@/components/AuthProvider"
import { TxProvider } from "./context/TxContext"
import Header from "@/components/Header"
import { Modal } from "@/components/ui/Modal"
import { WalletOptions } from "./WalletOptions"
import { elysium, ELYSIUM_RPC_URL } from "@/lib/chains"

const config = createConfig({
  chains: [sepolia, elysium],
  connectors: [injected()],
  // Prevent wagmi from rehydrating persisted wallet state during the first
  // client render, which would not match the server-rendered HTML.
  ssr: true,

  transports: {
    [sepolia.id]: http(),
    // Explicit RPC URL (not relying on the chain's default/public rpcUrls) —
    // Elysium is a brand-new testnet not covered by any public multi-chain
    // RPC aggregator, so we pin the transport to Kinetiq's own endpoint.
    [elysium.id]: http(ELYSIUM_RPC_URL),
  },
})

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  const [walletOptionsCard, setWalletModal] = useState<boolean>(false)

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TxProvider>
            <Header openWalletModal={() => setWalletModal(true)} />
            {walletOptionsCard && (
              <Modal
                id="woc"
                onClose={() => setWalletModal(false)}
                title="Connect wallet"
                titleClassName="text-sm"
                headerClassName="!pb-2"
                backdropClassName="absolute w-full bg-[#0000006b] bottom-0 left-0 h-full flex items-center justify-center z-200"
                panelClassName="min-w-[30%] gap-2"
              >
                <div className="p-4">
                  <WalletOptions onConnect={() => setWalletModal(false)} />
                </div>
              </Modal>
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
