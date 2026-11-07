import { beforeEach, describe, expect, it, vi } from "vitest"

const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
const from = vi.fn(() => ({ upsert }))

import { CollectionsRepository } from "./CollectionsRepository"

const contractAddress = "0x880176caEd2C38F889e5E0AD6Ae55A871dd0f3B5"
const timestamp = new Date("2026-01-01T00:00:00Z")

beforeEach(() => {
  vi.clearAllMocks()
})

// M-2: collections identity is (chain_id, contract_address); the address-only
// unique no longer exists, so onConflict "contract_address" would fail (42P10).
describe("CollectionsRepository.upsert (M-2)", () => {
  it("conflicts on (chain_id, contract_address) and writes chain_id", async () => {
    await new CollectionsRepository({ from } as never).upsert({
      contractAddress,
      chainId: 99801,
      creatorWallet: "0x373cDd612dE9857DeA8cA360EFc302405dD82860",
      name: "Test",
      symbol: "TST",
      royaltyFee: 0,
      isVerified: false,
      deployedAt: 1,
      indexerBlock: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    expect(from).toHaveBeenCalledWith("collections")
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ contract_address: contractAddress.toLowerCase(), chain_id: 99801 }),
      { onConflict: "chain_id,contract_address" },
    )
  })
})
