// lib/networkStatus.ts
// Pure decision behind <NetworkStatus /> (unit-tested without React/wagmi).

export type NetworkStatus =
  | { kind: "ok" }
  /** Connected to a chain the marketplace has no contracts on (ADDR-2). */
  | { kind: "unsupported"; walletChainId: number }
  /** Connected to another supported chain than the one the app shows. */
  | { kind: "wrong-chain"; walletChainId: number }

export function networkStatus(p: {
  isConnected: boolean
  walletChainId: number | undefined
  dataChainId: number
  hasContracts: (chainId: number) => boolean
}): NetworkStatus {
  if (!p.isConnected || p.walletChainId === undefined || p.walletChainId === p.dataChainId) return { kind: "ok" }
  if (!p.hasContracts(p.walletChainId)) return { kind: "unsupported", walletChainId: p.walletChainId }
  return { kind: "wrong-chain", walletChainId: p.walletChainId }
}
