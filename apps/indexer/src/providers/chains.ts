import { defineChain, type Chain } from "viem"
import { sepolia } from "viem/chains"
import { CHAIN_IDS } from "@marketplace/shared"

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPORTED VIEM CHAINS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Elysium testnet (Kinetiq) — Arbitrum Orbit (Nitro/ArbOS) L2 settling to HyperEVM.
 * Not in viem's built-in chain list, so it's defined manually here.
 */
export const elysium: Chain = defineChain({
  id: CHAIN_IDS.ELYSIUM,
  name: "Elysium Testnet (Kinetiq)",
  nativeCurrency: {
    name: "HYPE",
    symbol: "HYPE",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.elysium.kinetiq.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Elysium Explorer",
      url: "https://elysium.kinetiq.xyz/testnet-explorer",
    },
  },
  testnet: true,
})

/** Map of chain id -> viem Chain object, used by ViemRpcProvider to build the right client. */
export const VIEM_CHAINS_BY_ID: Record<number, Chain> = {
  [CHAIN_IDS.SEPOLIA]: sepolia,
  [CHAIN_IDS.ELYSIUM]: elysium,
}

export function getViemChain(chainId: number): Chain {
  return VIEM_CHAINS_BY_ID[chainId] ?? sepolia
}
