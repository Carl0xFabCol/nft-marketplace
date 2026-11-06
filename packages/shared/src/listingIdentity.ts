const COLLECTION_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/
const CANONICAL_TOKEN_ID_PATTERN = /^(0|[1-9][0-9]{0,77})$/
const RAW_TOKEN_ID_PATTERN = /^[0-9]+$/

export function normalizeCollectionAddress(address: string): string {
  const normalized = address.trim().toLowerCase()
  if (!COLLECTION_ADDRESS_PATTERN.test(normalized)) {
    throw new Error("Invalid collection address")
  }
  return normalized
}

export function normalizeTokenId(tokenId: string | bigint): string {
  const raw = String(tokenId).trim()
  if (!RAW_TOKEN_ID_PATTERN.test(raw)) {
    throw new Error("Invalid token id")
  }

  const normalized = raw.replace(/^0+(?=\d)/, "")
  if (!CANONICAL_TOKEN_ID_PATTERN.test(normalized)) {
    throw new Error("Invalid token id")
  }
  return normalized
}

export function tryNormalizeTokenId(tokenId: string | bigint): string | null {
  try {
    return normalizeTokenId(tokenId)
  } catch {
    return null
  }
}

export function normalizeChainId(chainId: number): number {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || chainId > 2147483647) {
    throw new Error("Invalid chain id")
  }
  return chainId
}

export function buildListingId(chainId: number, collectionAddress: string, tokenId: string | bigint): string {
  const chain = normalizeChainId(chainId)
  const collection = normalizeCollectionAddress(collectionAddress)
  const token = normalizeTokenId(tokenId)
  return `${chain}:${collection}-${token}`
}
