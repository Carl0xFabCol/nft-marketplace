import { describe, expect, it } from "vitest"
import { deactivateListingInNfts, listingKey, listingMatchesChain, upsertListingIntoNfts } from "./listingMerge"
import type { EnrichedUserNFT, UserListing } from "@/types/user.types"

const COLLECTION = "0x0000000000000000000000000000000000000010"

function nft(chainId: number, tokenId = "1"): EnrichedUserNFT {
  return {
    id: `${chainId}-${tokenId}`,
    token_id: tokenId,
    collection_address: COLLECTION,
    owner_wallet: "0x0000000000000000000000000000000000000002",
    chain_id: chainId,
  } as unknown as EnrichedUserNFT
}

function listing(chainId: number, tokenId = "1"): UserListing {
  return {
    id: `${chainId}-${tokenId}`,
    listing_id: `${chainId}:${COLLECTION}-${tokenId}`,
    collection_address: COLLECTION,
    token_id: tokenId,
    seller_wallet: "0x0000000000000000000000000000000000000002",
    buyer_wallet: null,
    price: "100",
    is_active: true,
    chain_id: chainId,
    listed_at: null,
    expires_at: null,
    tx_hash: `0x${"a".repeat(64)}`,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: null,
  }
}

describe("listingMerge", () => {
  it("does not merge the same collection/token across chains", () => {
    const nfts = [nft(99801), nft(11155111)]
    const merged = upsertListingIntoNfts(nfts, listing(99801))

    expect(merged[0].active_listing?.chain_id).toBe(99801)
    expect(merged[1].active_listing).toBeUndefined()
  })

  it("deactivates only the matching chain", () => {
    const nfts = [{ ...nft(99801), active_listing: listing(99801) }, { ...nft(11155111), active_listing: listing(11155111) }]
    const merged = deactivateListingInNfts(nfts, listing(11155111))

    expect(merged[0].active_listing).not.toBeNull()
    expect(merged[1].active_listing).toBeNull()
  })

  it("uses canonical token ids in the identity key", () => {
    expect(listingKey(99801, COLLECTION, "01")).toBe(listingKey(99801, COLLECTION, "1"))
    expect(listingKey(99801, COLLECTION, "1")).not.toBe(listingKey(11155111, COLLECTION, "1"))
  })

  it("ignores realtime rows from another chain", () => {
    expect(listingMatchesChain({ chain_id: 11155111 }, 99801)).toBe(false)
    expect(listingMatchesChain({ chain_id: 99801 }, 99801)).toBe(true)
  })

  it("ignores ambiguous realtime rows when a target chain is set", () => {
    expect(listingMatchesChain({ chain_id: null }, 99801)).toBe(false)
    expect(listingMatchesChain({}, 99801)).toBe(false)
    expect(listingMatchesChain(undefined, 99801)).toBe(false)
  })
})
