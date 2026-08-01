"use client"
import { LuWallet } from "react-icons/lu"
import { useConnect, useConnection, useConnectors } from "wagmi"
import Image from "next/image"
import { useEffect } from "react"
interface Props {
  onConnect: () => void
}
export function WalletOptions({ onConnect }: Props) {
  const { connect } = useConnect()
  const connectors = useConnectors()
  const { isConnected } = useConnection()

  useEffect(() => {
    if (isConnected) {
      onConnect()
    }
  }, [isConnected])
  return (
    <div className="flex flex-col gap-2 z-20 ">
      {connectors.map((connector) => (
        <button
          key={connector.uid}
          onClick={() => connect({ connector })}
          className="rounded flex items-center  w-full px-4 py-1 hover:opacity-100! not-hover:bg-transparent! hover:bg-(--accent)/20! text-(--text)! transition-colors duration-200"
        >
          <div className="flex flex-1 items-center justify-center">
            {connector.name == "Injected" && <LuWallet />}
            {connector.name == "Rabby Wallet" && <img src={"https://raw.githubusercontent.com/RabbyHub/logo/refs/heads/master/symbol.png"} className="w-8 " />}
            {connector.name == "Brave Wallet" && <img src={"https://avatars.githubusercontent.com/u/12301619?s=200&v=4"} className="w-8 p-1 " />}
            {connector.name == "Phantom" && (
              <div className="rounded-full overflow-hidden flex items-center justify-center w-8 h-8">
                <Image src="/phantom.png" alt="Phantom" width="20" height="20" />
              </div>
            )}
            {connector.name == "MetaMask" && (
              <div className="rounded-full overflow-hidden flex items-center justify-center w-8 h-8">
                <Image src="/metamask.png" alt="Metamask" width="20" height="20" />
              </div>
            )}
          </div>
          <span className="flex-5">{connector.name}</span>
          <div className="flex-1"></div>
        </button>
      ))}
    </div>
  )
}
