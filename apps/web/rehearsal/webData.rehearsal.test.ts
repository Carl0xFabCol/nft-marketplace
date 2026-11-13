// Phase 5 rehearsal, step 10: the web's data layer against the rehearsal DB
// (chain 31337) and the Anvil chain, with no browser.
//   - every service read is chain-scoped (a 99801 decoy with the SAME
//     collection address must never leak into a 31337 read, and vice versa);
//   - wei is read as exact text and equals the chain to the wei;
//   - the 23503 listings_nft_fk path: the real saveBatchListingToDB returns
//     not_indexed for a token the indexer has not recorded yet, and the real
//     retryOptimisticListing saves it once the indexer catches up.
// Driven by scripts/rehearsal (anvil-e2e), which sets REHEARSAL_* and stops /
// restarts the indexer around the 23503 test. Skipped without that env.
import { existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { createPublicClient, http, parseUnits, type Address, type Hex } from "viem"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { MarketplaceRouterAbi } from "@marketplace/contracts/abis/web"
import { SUPPORTED_CHAIN_IDS as SHARED_SUPPORTED } from "@marketplace/shared"

const E = process.env
const enabled = !!(E.REHEARSAL_SUPABASE_URL && E.REHEARSAL_SERVICE_ROLE_KEY && E.REHEARSAL_ANON_KEY && E.REHEARSAL_RPC_URL && E.REHEARSAL_ROUTER)
const CHAIN = 31337
const DECOY_CHAIN = 99801

function loopback(u: string | undefined): boolean {
  try {
    return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(new URL(u ?? "").hostname)
  } catch {
    return false
  }
}

// The optimistic-listing action authenticates the seller from a Supabase
// session cookie; the rehearsal has no browser session, so only that check is
// replaced (the seller is the Anvil account that really signed the listing).
vi.mock("@/lib/supabase/auth", () => ({ requireWalletMatch: vi.fn(async () => undefined) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

describe.skipIf(!enabled)("web data layer on the rehearsal chain (31337)", () => {
  let admin: SupabaseClient
  let anon: SupabaseClient
  let pub: ReturnType<typeof createPublicClient>
  const router = E.REHEARSAL_ROUTER as Address
  const decoyCollection = (E.REHEARSAL_COLLECTION_A ?? "").toLowerCase()

  beforeAll(async () => {
    for (const u of [E.REHEARSAL_SUPABASE_URL, E.REHEARSAL_RPC_URL]) if (!loopback(u)) throw new Error(`refusing non-loopback URL ${u}`)
    // The same in-memory registration launch.ts does for the indexer: 31337 is
    // supported inside this test process only.
    for (const list of [SHARED_SUPPORTED as number[], (await import("@/lib/chains")).SUPPORTED_CHAIN_IDS]) if (!list.includes(CHAIN)) list.push(CHAIN)
    process.env.NEXT_PUBLIC_SUPABASE_URL = E.REHEARSAL_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = E.REHEARSAL_ANON_KEY
    process.env.SUPABASE_SERVICE_ROLE_KEY = E.REHEARSAL_SERVICE_ROLE_KEY
    admin = createClient(E.REHEARSAL_SUPABASE_URL!, E.REHEARSAL_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    anon = createClient(E.REHEARSAL_SUPABASE_URL!, E.REHEARSAL_ANON_KEY!, { auth: { persistSession: false } })
    pub = createPublicClient({ transport: http(E.REHEARSAL_RPC_URL) })

    // Decoy: the SAME collection address and token on chain 99801, with a
    // different owner, listing price and stats.
    const decoyOwner = "0x000000000000000000000000000000000000dEaD".toLowerCase()
    expect((await admin.from("collections").insert({ chain_id: DECOY_CHAIN, contract_address: decoyCollection, name: "DECOY", total_volume: 999, total_sales: 999 })).error).toBeNull()
    expect((await admin.from("nfts").insert({ chain_id: DECOY_CHAIN, collection_address: decoyCollection, token_id: "1", owner_wallet: decoyOwner })).error).toBeNull()
    expect(
      (await admin.from("listings").insert({ chain_id: DECOY_CHAIN, collection_address: decoyCollection, token_id: "1", price: "1", seller_wallet: decoyOwner, tx_hash: `0x${"de".repeat(32)}`, listing_id: `${DECOY_CHAIN}:${decoyCollection}-1`, is_active: true })).error,
    ).toBeNull()
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from("listings").delete().eq("chain_id", DECOY_CHAIN)
    await admin.from("nfts").delete().eq("chain_id", DECOY_CHAIN)
    await admin.from("collections").delete().eq("chain_id", DECOY_CHAIN)
  })

  it("collection reads are chain-scoped and total_volume is exact text equal to getCollectionStats", async () => {
    const { CollectionService } = await import("@/services/collections.service")
    const top = await CollectionService.getTopCollectionsByVolume(anon, CHAIN, 50)
    expect(top.length).toBeGreaterThanOrEqual(4)
    expect(top.some((c) => c.name === "DECOY")).toBe(false)
    for (const c of top) {
      expect(typeof c.total_volume).toBe("string")
      const [volume] = (await pub.readContract({ address: router, abi: MarketplaceRouterAbi, functionName: "getCollectionStats", args: [c.contract_address as Address] })) as readonly [bigint, number, boolean, boolean]
      expect(parseUnits(c.total_volume ?? "0", 18), `total_volume of ${c.contract_address}`).toBe(volume)
    }
    const decoy = await CollectionService.getTopCollectionsByVolume(anon, DECOY_CHAIN, 50)
    expect(decoy.map((c) => c.name)).toEqual(["DECOY"])
  })

  it("NFT detail is chain-scoped: the 31337 token never shows the 99801 decoy's owner or listing", async () => {
    const { NFTService } = await import("@/services/nft.service")
    const real = await NFTService.getNFTDetail(decoyCollection as Address, "1", CHAIN)
    expect(real).not.toBeNull()
    expect(real!.owner_wallet).not.toBe("0x000000000000000000000000000000000000dead")
    expect(real!.chain_id).toBe(CHAIN)
    const owner = (await pub.readContract({ address: decoyCollection as Address, abi: [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256", name: "t" }], outputs: [{ type: "address", name: "" }] }] as const, functionName: "ownerOf", args: [BigInt(1)] })) as Address
    expect(real!.owner_wallet).toBe(owner.toLowerCase())
    const decoy = await NFTService.getNFTDetail(decoyCollection as Address, "1", DECOY_CHAIN)
    expect(decoy?.owner_wallet).toBe("0x000000000000000000000000000000000000dead")
    expect(decoy?.listing?.price).toBe("1")
  })

  it("every active listing a user sees has the exact on-chain price as text (no float rounding)", async () => {
    const { UserService } = await import("@/services/user.service")
    const { data: sellers } = await admin.from("listings").select("seller_wallet").eq("chain_id", CHAIN).eq("is_active", true)
    const unique = [...new Set((sellers ?? []).map((s) => s.seller_wallet as string))]
    expect(unique.length).toBeGreaterThan(0)
    let checked = 0
    for (const seller of unique) {
      const listings = await UserService.getUserListings(anon, seller as Address, CHAIN)
      for (const l of listings) {
        expect(typeof l.price).toBe("string")
        const s = (await pub.readContract({ address: router, abi: MarketplaceRouterAbi, functionName: "listings", args: [l.collection_address as Address, BigInt(l.token_id)] })) as { price: bigint }
        expect(l.price, `${l.collection_address}#${l.token_id}`).toBe(s.price.toString())
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it.skipIf(!E.REHEARSAL_23503)("23503: a listing for a not-yet-indexed NFT returns not_indexed, and the real retry saves it once indexed", async () => {
    const spec = JSON.parse(E.REHEARSAL_23503!) as { txHash: Hex; collection: Address; tokenId: string; price: string; expiresAt: string; seller: Address }
    const markerDir = E.REHEARSAL_MARKER_DIR!
    const { saveBatchListingToDB } = await import("@/actions/listings/createBatch")
    const { retryOptimisticListing } = await import("@/lib/optimisticListing")
    const save = () =>
      saveBatchListingToDB({ txHash: spec.txHash, collections: [spec.collection], tokenIds: [spec.tokenId], prices: [spec.price], seller: spec.seller, chainId: CHAIN, expiresAts: [spec.expiresAt] })

    const nft = await admin.from("nfts").select("token_id").eq("chain_id", CHAIN).eq("collection_address", spec.collection.toLowerCase()).eq("token_id", spec.tokenId)
    expect(nft.data, "precondition: the indexer has not recorded this NFT yet").toEqual([])
    expect(await save()).toEqual({ success: false, reason: "not_indexed" })

    // The real retry helper, with a sleep hook that asks the driver to start
    // the indexer and waits until the nfts row exists.
    let asked = false
    const outcome = await retryOptimisticListing(save, {
      delaysMs: [0, 0, 0, 0],
      sleep: async () => {
        if (!asked) {
          writeFileSync(path.join(markerDir, "start-indexer"), "1")
          asked = true
        }
        for (let i = 0; i < 300; i++) {
          const r = await admin.from("nfts").select("token_id").eq("chain_id", CHAIN).eq("collection_address", spec.collection.toLowerCase()).eq("token_id", spec.tokenId)
          if ((r.data ?? []).length > 0) return
          await new Promise((res) => setTimeout(res, 200))
        }
      },
    })
    expect(outcome).toBe("saved")
    expect(existsSync(path.join(markerDir, "start-indexer"))).toBe(true)

    const { data } = await admin.from("listings").select("price::text,seller_wallet,is_active,tx_hash").eq("chain_id", CHAIN).eq("collection_address", spec.collection.toLowerCase()).eq("token_id", spec.tokenId).single()
    expect(data).toMatchObject({ price: spec.price, seller_wallet: spec.seller.toLowerCase(), is_active: true })
  })
})
