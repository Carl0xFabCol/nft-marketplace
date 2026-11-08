"use client"

import { useSyncExternalStore } from "react"
import { useConnection, useSwitchChain } from "wagmi"
import { getContractAddresses } from "@marketplace/contracts"
import { DATA_CHAIN_ID, chainLabel } from "@/lib/chainGuard"
import { networkStatus } from "@/lib/networkStatus"

const emptySubscribe = () => () => {}

/**
 * App-wide "switch network" state (ADDR-2). Shown while a connected wallet is on
 * any chain other than the data chain. Browsing keeps working (data is always
 * the data chain's); every write is refused by useWriteGuard until the wallet
 * switches. Disconnected wallets see nothing.
 */
export function NetworkStatus() {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )
  const { isConnected, chainId } = useConnection()
  const { switchChain, isPending } = useSwitchChain()

  const status = networkStatus({ isConnected, walletChainId: chainId, dataChainId: DATA_CHAIN_ID, hasContracts: (id) => !!getContractAddresses(id) })
  if (!mounted || status.kind === "ok") return null

  return (
    <div role="alert" className="w-full flex flex-wrap items-center justify-center gap-3 px-4 py-2 text-sm bg-[#c19137]/20 border-b border-[#c19137]/60">
      <span>
        {status.kind === "unsupported"
          ? `Your wallet is on an unsupported network (chain ${status.walletChainId}).`
          : `Your wallet is on ${chainLabel(status.walletChainId)}; this marketplace shows ${chainLabel(DATA_CHAIN_ID)}.`}{" "}
        Transactions are disabled until you switch.
      </span>
      <button onClick={() => switchChain({ chainId: DATA_CHAIN_ID })} disabled={isPending} className="px-3 py-1 rounded">
        {isPending ? "Switching…" : `Switch to ${chainLabel(DATA_CHAIN_ID)}`}
      </button>
    </div>
  )
}
