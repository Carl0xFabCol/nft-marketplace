"use server"

import { Address } from "viem"
import { getSession } from "@/lib/auth/session"

export interface BatchListingData {
  txHash: `0x${string}`
  collections: Address[]
  tokenIds: string[]
  prices: string[]
  seller: Address
  chainId: number
  expiresAts: string[]
}

export async function saveBatchListingToDB(data: BatchListingData) {
  const session = await getSession()
  if (!session) throw new Error("Unauthorized")

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  await fetch(`${baseUrl}/api/listings/optimistic`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `sb-access-token=${session.token}`,
    },
    body: JSON.stringify(data),
  })
}

export async function confirmBatchListing(txHash: `0x${string}`) {
  const session = await getSession()
  if (!session) throw new Error("Unauthorized")

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  await fetch(`${baseUrl}/api/listings/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `sb-access-token=${session.token}`,
    },
    body: JSON.stringify({ txHash }),
  })
}

export async function failBatchListing(txHash: `0x${string}`) {
  const session = await getSession()
  if (!session) throw new Error("Unauthorized")

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  await fetch(`${baseUrl}/api/listings/fail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `sb-access-token=${session.token}`,
    },
    body: JSON.stringify({ txHash }),
  })
}
