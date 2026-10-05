// lib/chains.ts
// Single source for the chains the app supports (Sepolia + Elysium) and their
// explorer base URLs. Elysium is a custom Arbitrum-Orbit L2 not natively known
// to viem/wagmi, so it needs an explicit defineChain().
import { defineChain } from "viem"
import { sepolia } from "wagmi/chains"

/** Canonical Elysium testnet (Kinetiq) public RPC endpoint. */
export const ELYSIUM_RPC_URL = "https://testnet-rpc.elysium.kinetiq.xyz"

/**
 * Elysium testnet (Kinetiq) — Arbitrum Orbit (Nitro/ArbOS) L2 settling to HyperEVM.
 * Not in viem/wagmi's built-in chain list, so it's defined manually here.
 */
export const elysium = defineChain({
  id: 99801,
  name: "Elysium Testnet (Kinetiq)",
  nativeCurrency: {
    name: "HYPE",
    symbol: "HYPE",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [ELYSIUM_RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: "Elysium Explorer",
      url: "https://elysium.kinetiq.xyz/testnet-explorer",
    },
  },
  testnet: true,
})

/** All chains selectable in the app, side-by-side. */
export const SUPPORTED_CHAINS = [sepolia, elysium] as const
export const SUPPORTED_CHAIN_IDS: number[] = SUPPORTED_CHAINS.map((c) => c.id)

/** The chain the app defaults to when none/an unsupported one is connected. */
export const CHAIN_ID = elysium.id

/** Explorer base URL per chain id. */
export const EXPLORER_URLS: Record<number, string> = {
  [sepolia.id]: "https://sepolia.etherscan.io",
  [elysium.id]: "https://elysium.kinetiq.xyz/testnet-explorer",
}

const explorerBaseUrl = (chainId: number = CHAIN_ID) => EXPLORER_URLS[chainId] ?? EXPLORER_URLS[CHAIN_ID]

/** Backward-compatible constant (defaults to the current default chain's explorer). */
export const EXPLORER_URL = EXPLORER_URLS[CHAIN_ID]

export const explorerTxUrl = (hash: string, chainId?: number) => `${explorerBaseUrl(chainId)}/tx/${hash}`
export const explorerAddressUrl = (address: string, chainId?: number) => `${explorerBaseUrl(chainId)}/address/${address}`
export const explorerTokenUrl = (address: string, chainId?: number) => `${explorerBaseUrl(chainId)}/token/${address}`
export const explorerTokenInstanceUrl = (address: string, tokenId: string, chainId?: number) =>
  `${explorerBaseUrl(chainId)}/token/${address}?a=${tokenId}`

