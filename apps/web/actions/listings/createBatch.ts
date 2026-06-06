import { Address } from "viem"
import { MarketplaceABI } from "@/lib/abi"
import { MARKETPLACE_CONTRACT_ADDRESS } from "@/lib/constants"
import { TxItem } from "@/app/context/TxContext"
interface BatchListingInput {
  collections: Address[]
  tokenIds: bigint[]
  prices: bigint[]
  expiresAts: bigint[]
  seller: Address
  chainId: number

  token?: string

  // Injected dependencies from the component
  writeContractAsync: (args: any) => Promise<`0x${string}`>
  publicClient: any
  addTx: (tx: TxItem) => void
  updateTx: (hash: string, update: Partial<TxItem>) => void
  removeTx: (hash: `0x${string}`) => void
}

export async function createBatchListing({ collections, tokenIds, prices, expiresAts, seller, chainId, token, writeContractAsync, publicClient, addTx, updateTx, removeTx }: BatchListingInput) {
  // 1. Submit the transaction
  let hash: `0x${string}`
  try {
    hash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "createListingBatch",
      args: [collections, tokenIds, prices, expiresAts],
    })
  } catch (err) {
    console.error("User rejected or error", err)
    throw err // let the component handle the display
  }

  // 2. Immediately add tx to the UI (your TxContext)
  addTx({
    hash,
    status: "loading",
    label: `Listing ${tokenIds.length} items...`,
  })

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`

  // 3. Optimistic DB write – don’t wait for the indexer
  await fetch("/api/listings/optimistic", {
    method: "POST",
    headers,
    body: JSON.stringify({
      txHash: hash,
      collection: collections[0],
      tokenIds: tokenIds.map((id) => id.toString()),
      seller,
      prices: prices.map((p) => p.toString()),
      chainId,
      expiresAts: expiresAts.map((e) => e.toString()),
    }),
  }).catch((err) => console.error("Optimistic write failed", err))

  // 4. Wait for on‑chain confirmation
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    updateTx(hash, { status: "success", label: "Listed!" })

    // 5. Confirm the optimistic records
    fetch("/api/listings/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ txHash: hash }),
    }).catch((err) => console.error("Confirm API failed", err))

    setTimeout(() => removeTx(hash), 3000)
  } catch (err) {
    // 6. If receipt waiting fails (tx reverted or timeout)
    updateTx(hash, { status: "error", label: "Listing failed" })
    fetch("/api/listings/fail", {
      method: "POST",
      headers,
      body: JSON.stringify({ txHash: hash }),
    }).catch((e) => console.error("Fail API failed", e))

    setTimeout(() => removeTx(hash), 5000)
    throw err
  }
}
