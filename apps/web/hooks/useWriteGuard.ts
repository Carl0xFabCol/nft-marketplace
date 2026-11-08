"use client"

import { useCallback } from "react"
import { useConfig } from "wagmi"
import { getConnection } from "wagmi/actions"
import type { ContractAddresses } from "@marketplace/contracts"
import { assertWriteTarget } from "@/lib/chainGuard"

/**
 * Returns a function that every contract write calls right before
 * `writeContractAsync`. It reads the wallet's chain at call time (not a render
 * snapshot), throws a ChainGuardError when the wallet is disconnected, on
 * another chain, or the chain has no marketplace deployment, and otherwise
 * returns that chain's contract addresses. Writes also pass `chainId`, so wagmi
 * re-asserts the chain when it builds the transaction.
 */
export function useWriteGuard(chainId: number): () => ContractAddresses {
  const config = useConfig()
  return useCallback(() => assertWriteTarget(getConnection(config).chainId, chainId), [config, chainId])
}
