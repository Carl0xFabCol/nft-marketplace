import { randomUUID } from "node:crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

// These tests perform real authorization checks against a Supabase project.
// Point them ONLY at a disposable test/staging project where the SEC-01
// migrations have been applied. They create and delete their own auth users,
// profiles and (if a bug lets the write through) listing rows.
const url = process.env.SEC01_TEST_SUPABASE_URL
const anonKey = process.env.SEC01_TEST_SUPABASE_ANON_KEY
const serviceKey = process.env.SEC01_TEST_SUPABASE_SERVICE_ROLE_KEY
const configured = Boolean(url && anonKey && serviceKey)

function hex(bytes = 16): string {
  return Array.from({ length: bytes }, () => randomUUID().replace(/-/g, "").slice(0, 2)).join("")
}

function randomWallet(): string {
  return `0x${hex(20)}`
}

function randomAddress(): string {
  return `0x${hex(20)}`
}

function randomTxHash(): string {
  return `0x${hex(32)}`
}

describe.skipIf(!configured)("SEC-01 database authorization", () => {
  let admin: SupabaseClient
  let anon: SupabaseClient
  let userAClient: SupabaseClient
  let userA: { id: string; email: string; password: string }
  let userB: { id: string; email: string; password: string }
  let userC: { id: string; email: string; password: string }
  let walletA: string
  let walletB: string
  const createdTxHashes: string[] = []
  const createdCollections: string[] = []

  // listings has a FK to nfts(collection_address, token_id, chain_id), and nfts
  // has a FK to collections. Create the parents a listing batch needs.
  async function ensureNfts(collection: string, chainId: number, tokenIds: string[], owner: string) {
    createdCollections.push(collection)
    const { error: collectionError } = await admin
      .from("collections")
      .insert({ contract_address: collection, chain_id: chainId })
    if (collectionError) throw collectionError
    const { error: nftError } = await admin.from("nfts").insert(
      tokenIds.map((token_id) => ({ collection_address: collection, token_id, owner_wallet: owner, chain_id: chainId })),
    )
    if (nftError) throw nftError
  }

  async function createTestUser(label: string, wallet: string) {
    const email = `sec01-${label}-${randomUUID()}@example.com`
    const password = `${randomUUID()}Aa1!`

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { wallet },
    })

    if (error || !data.user) {
      throw new Error(`Failed to create ${label} test user: ${error?.message ?? "unknown error"}`)
    }

    return { id: data.user.id, email, password }
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    anon = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    walletA = randomWallet()
    walletB = randomWallet()

    userA = await createTestUser("a", walletA)
    userB = await createTestUser("b", walletB)
    userC = await createTestUser("c", randomWallet())

    // Clear any auth-trigger-created mappings before inserting deterministic
    // test mappings. userC is only used to prove wallet uniqueness.
    await admin
      .from("user_wallets")
      .delete()
      .in("supabase_user_id", [userA.id, userB.id, userC.id])

    const { error: profileError } = await admin.from("profiles").upsert(
      [
        { id: userA.id, wallet: walletA },
        { id: userB.id, wallet: walletB },
      ],
      { onConflict: "id" },
    )

    if (profileError) throw profileError

    const { error: mappingError } = await admin.from("user_wallets").insert([
      {
        wallet_address: walletA,
        supabase_user_id: userA.id,
        email: userA.email,
        supabase_password: userA.password,
      },
      {
        wallet_address: walletB,
        supabase_user_id: userB.id,
        email: userB.email,
        supabase_password: userB.password,
      },
    ])

    if (mappingError) throw mappingError

    userAClient = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { error: signInError } = await userAClient.auth.signInWithPassword({
      email: userA.email,
      password: userA.password,
    })

    if (signInError) throw signInError
  })

  afterAll(async () => {
    if (!admin) return

    if (createdTxHashes.length > 0) {
      await admin.from("listings").delete().in("tx_hash", createdTxHashes)
    }

    if (createdCollections.length > 0) {
      await admin.from("nfts").delete().in("collection_address", createdCollections)
      await admin.from("collections").delete().in("contract_address", createdCollections)
    }

    const ids = [userA?.id, userB?.id, userC?.id].filter((id): id is string => Boolean(id))
    if (ids.length > 0) {
      await admin.from("user_wallets").delete().in("supabase_user_id", ids)
    }

    if (ids.length > 0) {
      await admin.from("profiles").delete().in("id", ids)
    }

    for (const id of ids) {
      await admin.auth.admin.deleteUser(id)
    }
  })

  it("allows anon to read public profiles", async () => {
    const { data, error } = await anon.from("profiles").select("id, wallet, username, bio, avatar_url").eq("id", userA.id)

    expect(error).toBeNull()
    expect(data).toEqual([expect.objectContaining({ id: userA.id, wallet: walletA })])
  })

  it("allows anon to read public listings", async () => {
    const { error } = await anon.from("listings").select("id").limit(1)

    expect(error).toBeNull()
  })

  it("denies anon access to user_wallets", async () => {
    const { data, error } = await anon.from("user_wallets").select("*")

    expect(error !== null || (data?.length ?? 0) === 0).toBe(true)
  })

  it("denies anon access to nonces", async () => {
    const { data, error } = await anon.from("nonces").select("*")

    expect(error !== null || (data?.length ?? 0) === 0).toBe(true)
  })

  it("denies anon writes to listings", async () => {
    const txHash = randomTxHash()
    createdTxHashes.push(txHash)

    const { error } = await anon.from("listings").insert({
      collection_address: randomAddress(),
      token_id: "1",
      chain_id: 99801,
      tx_hash: txHash,
      price: 1,
      is_active: false,
      created_at: new Date().toISOString(),
    })

    expect(error).not.toBeNull()
  })

  it("allows a profile owner to update username, bio and avatar_url", async () => {
    // No .select()/return=representation: the authenticated role intentionally
    // has column-level UPDATE grants but no table-level SELECT on profiles.
    const { error } = await userAClient
      .from("profiles")
      .update({ username: "sec01-owner", bio: "authorized update", avatar_url: null })
      .eq("id", userA.id)

    expect(error).toBeNull()

    const { data: after, error: readError } = await admin
      .from("profiles")
      .select("id, username, bio, avatar_url")
      .eq("id", userA.id)
      .single()

    expect(readError).toBeNull()
    expect(after).toEqual({
      id: userA.id,
      username: "sec01-owner",
      bio: "authorized update",
      avatar_url: null,
    })
  })

  it("denies a direct authenticated update of profiles.wallet", async () => {
    const { error } = await userAClient
      .from("profiles")
      .update({ wallet: walletB })
      .eq("id", userA.id)

    expect(error).not.toBeNull()

    const { data: after } = await admin.from("profiles").select("wallet").eq("id", userA.id).single()
    expect(after?.wallet).toBe(walletA)
  })

  it("denies authenticated clients from updating another profile", async () => {
    const { error } = await userAClient
      .from("profiles")
      .update({ username: "sec01-hijack" })
      .eq("id", userB.id)

    expect(error).toBeNull()

    const { data: after } = await admin.from("profiles").select("username").eq("id", userB.id).single()
    expect(after?.username).not.toBe("sec01-hijack")
  })

  it("denies anon and authenticated SELECT of profiles.email", async () => {
    const anonResult = await anon.from("profiles").select("email").eq("id", userA.id)
    const authResult = await userAClient.from("profiles").select("email").eq("id", userA.id)

    expect(anonResult.error).not.toBeNull()
    expect(anonResult.data).toBeNull()
    expect(authResult.error).not.toBeNull()
    expect(authResult.data).toBeNull()
  })

  it("denies authenticated update of profiles.email", async () => {
    const { error } = await userAClient
      .from("profiles")
      .update({ email: "sec01-changed@example.com" })
      .eq("id", userA.id)

    expect(error).not.toBeNull()

    const { data: after } = await admin.from("profiles").select("email").eq("id", userA.id).single()
    expect(after?.email).not.toBe("sec01-changed@example.com")
  })

  it("denies authenticated access to user_wallets", async () => {
    const { data, error } = await userAClient.from("user_wallets").select("*")

    expect(error !== null || (data?.length ?? 0) === 0).toBe(true)
  })

  it("denies authenticated access to nonces", async () => {
    const { data, error } = await userAClient.from("nonces").select("*")

    expect(error !== null || (data?.length ?? 0) === 0).toBe(true)
  })

  it("denies authenticated writes to listings", async () => {
    const txHash = randomTxHash()
    createdTxHashes.push(txHash)

    const { error } = await userAClient.from("listings").insert({
      collection_address: randomAddress(),
      token_id: "1",
      chain_id: 99801,
      tx_hash: txHash,
      price: 1,
      is_active: false,
      created_at: new Date().toISOString(),
      seller_wallet: walletA,
    })

    expect(error).not.toBeNull()
  })

  it("allows repeated listing batches for the same seller and tx hash", async () => {
    const txHash = randomTxHash()
    const collection = randomAddress()
    createdTxHashes.push(txHash)
    await ensureNfts(collection, 99801, ["9101", "9102"], walletA)

    const first = await admin.rpc("sec01_save_listing_batch", {
      p_seller: walletA,
      p_tx_hash: txHash,
      p_chain_id: 99801,
      p_rows: [{ collection_address: collection, token_id: "9101", price: "1", expires_at: null }],
    })
    const second = await admin.rpc("sec01_save_listing_batch", {
      p_seller: walletA,
      p_tx_hash: txHash,
      p_chain_id: 99801,
      p_rows: [{ collection_address: collection, token_id: "9102", price: "1", expires_at: null }],
    })

    expect(first.error).toBeNull()
    expect(first.data).toBe(1)
    expect(second.error).toBeNull()
    expect(second.data).toBe(1)
  })

  it("serializes concurrent listing batches sharing a tx hash", async () => {
    const txHash = randomTxHash()
    const collection = randomAddress()
    createdTxHashes.push(txHash)
    await ensureNfts(collection, 99801, ["9201", "9202"], walletA)

    const [a, b] = await Promise.all([
      admin.rpc("sec01_save_listing_batch", {
        p_seller: walletA,
        p_tx_hash: txHash,
        p_chain_id: 99801,
        p_rows: [{ collection_address: collection, token_id: "9201", price: "1", expires_at: null }],
      }),
      admin.rpc("sec01_save_listing_batch", {
        p_seller: walletB,
        p_tx_hash: txHash,
        p_chain_id: 99801,
        p_rows: [{ collection_address: collection, token_id: "9202", price: "1", expires_at: null }],
      }),
    ])

    const results = [a, b]
    expect(results.filter((result) => result.error === null)).toHaveLength(1)
    expect(results.filter((result) => result.error !== null)).toHaveLength(1)
    expect(results.find((result) => result.error !== null)?.error?.code).toBe("42501")
  })

  it("rejects a listing batch that overwrites another seller's active listing", async () => {
    const firstTx = randomTxHash()
    const secondTx = randomTxHash()
    const collection = randomAddress()
    createdTxHashes.push(firstTx, secondTx)
    await ensureNfts(collection, 99801, ["9301"], walletA)

    const first = await admin.rpc("sec01_save_listing_batch", {
      p_seller: walletA,
      p_tx_hash: firstTx,
      p_chain_id: 99801,
      p_rows: [{ collection_address: collection, token_id: "9301", price: "1", expires_at: null }],
    })
    const second = await admin.rpc("sec01_save_listing_batch", {
      p_seller: walletB,
      p_tx_hash: secondTx,
      p_chain_id: 99801,
      p_rows: [{ collection_address: collection, token_id: "9301", price: "2", expires_at: null }],
    })

    expect(first.error).toBeNull()
    expect(second.error).not.toBeNull()
    expect(second.error?.code).toBe("42501")
  })

  it("rejects a non-canonical profile wallet", async () => {
    const { error } = await admin
      .from("profiles")
      .upsert({ id: userC.id, wallet: walletA.toUpperCase() }, { onConflict: "id" })

    expect(error).not.toBeNull()
    expect(error?.code).toBe("23514")
  })

  it("rejects a duplicate profile wallet", async () => {
    const { error } = await admin
      .from("profiles")
      .upsert({ id: userC.id, wallet: walletA }, { onConflict: "id" })

    expect(error).not.toBeNull()
    expect(error?.code).toBe("23505")
  })

  it("rejects a duplicate user_wallets mapping", async () => {
    const { error } = await admin.from("user_wallets").insert({
      wallet_address: walletA,
      supabase_user_id: userC.id,
      email: userC.email,
      supabase_password: userC.password,
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe("23505")
  })

  it("rejects a second wallet for the same Supabase Auth user", async () => {
    const { error } = await admin.from("user_wallets").insert({
      wallet_address: randomWallet(),
      supabase_user_id: userA.id,
      email: userA.email,
      supabase_password: userA.password,
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe("23505")
  })

  it("rejects a non-canonical user_wallets address", async () => {
    const { error } = await admin
      .from("user_wallets")
      .update({ wallet_address: walletB.toUpperCase() })
      .eq("supabase_user_id", userB.id)

    expect(error).not.toBeNull()
    expect(error?.code).toBe("23514")
  })

  it("maps each auth user to exactly one canonical wallet", async () => {
    const { data, error } = await admin
      .from("user_wallets")
      .select("supabase_user_id, wallet_address")
      .in("supabase_user_id", [userA.id, userB.id])

    expect(error).toBeNull()
    expect(data).toHaveLength(2)
    expect(data).toEqual(
      expect.arrayContaining([
        { supabase_user_id: userA.id, wallet_address: walletA },
        { supabase_user_id: userB.id, wallet_address: walletB },
      ]),
    )
  })
})
