"use server"
import { Address } from "viem"
import { MarketplaceABI } from "@/lib/abi"
import { MARKETPLACE_CONTRACT_ADDRESS } from "@/lib/constants"
import { TxItem } from "@/app/context/TxContext"
import { getSession } from "@/lib/auth/session"
import { cookies } from "next/headers"

interface ListingInput {
  collection: Address
  tokenId: bigint
  price: bigint
  expiresAt: bigint
  seller: Address
  chainId: number

  // Injected dependencies from the component
  writeContractAsync: (args: any) => Promise<`0x${string}`>
  publicClient: any
  addTx: (tx: TxItem) => void
  updateTx: (hash: string, update: Partial<TxItem>) => void
  removeTx: (hash: `0x${string}`) => void
}

export async function createListing({ collection, tokenId, price, expiresAt, seller, chainId, writeContractAsync, publicClient, addTx, updateTx, removeTx }: ListingInput) {
  const session = await getSession()
  if (!session) {
    throw new Error("Unauthorized")
  }

  // 1. Submit the transaction
  let hash: `0x${string}`
  try {
    hash = await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "createListing",
      args: [collection, tokenId, price, expiresAt],
    })
  } catch (err) {
    console.error("User rejected or error", err)
    throw err
  }

  addTx({
    hash,
    status: "loading",
    label: `Listing item...`,
  })

  const cookieStore = await cookies()
  const token = cookieStore.get("sb-access-token")?.value
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Cookie: `sb-access-token=${token}` } : {}),
  }

  // 3. Optimistic DB write – don’t wait for the indexer
  await fetch("/api/listings/optimistic", {
    method: "POST",
    headers,
    body: JSON.stringify({
      txHash: hash,
      collection: collection,
      tokenIds: tokenId.toString(),
      seller,
      prices: price.toString(),
      chainId,
      expiresAts: expiresAt.toString(),
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
