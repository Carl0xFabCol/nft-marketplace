import type { PublicClient, TransactionReceipt } from "viem"

/**
 * Waits until a transaction is mined and verifies it did not revert.
 *
 * `waitForTransactionReceipt` resolves with a receipt even when the tx
 * reverted on-chain, so callers must check `status`. This helper centralises
 * that check and throws a descriptive error so the Tx popup can be updated to
 * its success/error state instead of hanging on "loading".
 */
export async function waitForTxConfirmation(
  publicClient: PublicClient | undefined,
  hash: `0x${string}`,
): Promise<TransactionReceipt> {
  if (!publicClient) throw new Error("Public client is not available")

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  if (receipt.status !== "success") {
    throw new Error("Transaction reverted on-chain")
  }

  return receipt
}
