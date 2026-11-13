// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation: DB vs chain, exactly (Phase 5 success criterion; seed of the
// Phase 7 reconciliation job). No tolerance anywhere: wei are bigints, the DB
// is read with ::text casts, and every chain read is pinned at one block
// (indexer_state.last_block by default), so indexer lag is never a mismatch.
//
// Layout: collectChain() and collectDb() gather plain snapshots; diff() is a
// pure function over them (unit-tested offline in __tests__/reconcile.test.ts).
// It works against any Supabase project (service role, read-only queries) and
// any RPC: nothing here is rehearsal-specific.
// ─────────────────────────────────────────────────────────────────────────────

import { getAddress, parseUnits, type Address, type Hex, type Log, type PublicClient } from "viem"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Erc721TransferEventAbi, MarketplaceBidsEventsAbi, MarketplaceCoreEventsAbi } from "@marketplace/contracts/abis/generated/events"
import { MarketplaceRouterAbi } from "@marketplace/contracts/abis/web"

// ── snapshots ───────────────────────────────────────────────────────────────

export interface ChainLog {
  source: "core" | "bids" | "collection"
  contract: string // lower-case
  eventName: string
  args: Record<string, unknown>
  txHash: string // lower-case
  logIndex: number
  blockNumber: bigint
  blockTimestamp: bigint
}

export interface ChainCollection {
  address: string // lower-case
  registeredAtBlock: bigint
  volumeWei: bigint
  sales: number
  verified: boolean
  exists: boolean
  storedRoyaltyBps: number
  overridden: boolean
}
export interface ChainListing {
  collection: string
  tokenId: string
  seller: string // lower-case; zero = none
  price: bigint
  listedAt: bigint
  expiresAt: bigint
  feeBps: number
  royaltyBps: number
}
export interface ChainTokenBid {
  collection: string
  tokenId: string
  bidder: string
  price: bigint // 0 = no active bid
  expiresAt: bigint
}
export interface ChainCollectionBid {
  collection: string
  bidder: string
  pricePerItem: bigint
  quantity: number // 0 = no active bid
  expiresAt: bigint
}
export interface ChainToken {
  collection: string
  tokenId: string
  owner: string // ownerOf at the pinned block, lower-case
  lastTransferTo: string
}

export interface ChainSnapshot {
  atBlock: bigint
  logs: ChainLog[]
  collections: ChainCollection[]
  listings: ChainListing[]
  tokenBids: ChainTokenBid[]
  collectionBids: ChainCollectionBid[]
  tokens: ChainToken[]
}

export interface DbActivity {
  event: string
  tx_hash: string
  log_index: string
  created_at: string
  collection_address: string | null
  token_id: string | null
  price: string | null
  chain_id: number
}
export interface DbCollection {
  contract_address: string
  total_volume: string | null
  total_sales: string | null
  is_verified: boolean | null
  royalty_fee: number | null
}
export interface DbListing {
  collection_address: string
  token_id: string
  seller_wallet: string | null
  price: string
  is_active: boolean
  expires_at: string | null
  listed_at: string | null
}
export interface DbTokenBid {
  collection_address: string
  token_id: string
  bidder_wallet: string
  price: string
  is_active: boolean
  expires_at: string | null
}
export interface DbCollectionBid {
  collection_address: string
  bidder_wallet: string
  price: string
  quantity: string | null
  is_active: boolean
  expires_at: string | null
}
export interface DbNft {
  collection_address: string
  token_id: string
  owner_wallet: string
}
export interface DbSnapshot {
  lastBlock: bigint | null
  activity: DbActivity[]
  collections: DbCollection[]
  listings: DbListing[]
  tokenBids: DbTokenBid[]
  collectionBids: DbCollectionBid[]
  nfts: DbNft[]
}

// ── the indexer's event coverage (apps/indexer/src/config/contracts.config.ts) ─

/** Events the indexer writes one activity row for, per source contract. */
export const INDEXED_EVENTS: Readonly<Record<ChainLog["source"], readonly string[]>> = {
  core: [
    "CollectionRegistered",
    "CollectionVerified",
    "CollectionUnverified",
    "CollectionRoyaltyUpdated",
    "RoyaltyOverrideCleared",
    "LaunchpadAuthorized",
    "ListingCreated",
    "ListingUpdated",
    "ListingCancelled",
    "Sale",
    "Withdrawal",
    "MarketplaceFeeUpdated",
    "FeeReceiverUpdated",
    "OwnershipTransferred",
    "Paused",
    "Unpaused",
  ],
  bids: ["CollectionBidPlaced", "CollectionBidAccepted", "CollectionBidCancelled", "TokenBidPlaced", "TokenBidAccepted", "TokenBidCancelled", "Withdrawal", "Paused", "Unpaused"],
  collection: ["Transfer"],
}

/** activity.event for an indexed log (UPPER_SNAKE of the event name; LaunchpadAuthorized splits). */
export function activityType(log: Pick<ChainLog, "eventName" | "args">): string {
  if (log.eventName === "LaunchpadAuthorized") return log.args.authorized ? "LAUNCHPAD_AUTHORIZED" : "LAUNCHPAD_DEAUTHORIZED"
  return log.eventName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()
}

export function isIndexed(log: Pick<ChainLog, "source" | "eventName">): boolean {
  return INDEXED_EVENTS[log.source].includes(log.eventName)
}

// ── diff ────────────────────────────────────────────────────────────────────

export interface Mismatch {
  area: "activity" | "collections" | "listings" | "token_bids" | "collection_bids" | "nfts" | "cursor"
  key: string
  field: string
  db: string
  chain: string
}

export interface ReconcileReport {
  atBlock: bigint
  mismatches: Mismatch[]
  info: string[]
  counts: {
    logs: number
    indexedLogs: number
    activityRows: number
    perType: Record<string, { chain: number; db: number }>
    collections: number
    listingsActive: number
    tokenBidsActive: number
    collectionBidsActive: number
    nfts: number
  }
}

const ZERO = "0x0000000000000000000000000000000000000000"
const epoch = (ts: string | null): bigint | null => (ts === null ? null : BigInt(Math.floor(Date.parse(ts) / 1000)))
const lc = (s: string | null | undefined) => (s ?? "").toLowerCase()
const str = (v: unknown) => (v === null || v === undefined ? "null" : typeof v === "bigint" ? v.toString() : String(v))

/** collections.total_volume is ether-denominated numeric (indexer adds wei * 1e-18); exact conversion back. */
export function etherTextToWei(text: string | null): bigint {
  if (text === null || text === "") return 0n
  return parseUnits(text, 18)
}

export function diff(chain: ChainSnapshot, db: DbSnapshot): ReconcileReport {
  const out: Mismatch[] = []
  const info: string[] = []
  const add = (m: Mismatch) => out.push(m)

  if (db.lastBlock !== chain.atBlock) add({ area: "cursor", key: "indexer_state", field: "last_block", db: str(db.lastBlock), chain: str(chain.atBlock) })

  // ── activity: identity-level, then per type ──────────────────────────────
  const rows = new Map<string, DbActivity[]>()
  for (const r of db.activity) {
    const k = `${lc(r.tx_hash)}:${Number(r.log_index)}`
    rows.set(k, [...(rows.get(k) ?? []), r])
  }
  const perType: Record<string, { chain: number; db: number }> = {}
  const bump = (t: string, side: "chain" | "db") => ((perType[t] ??= { chain: 0, db: 0 })[side] += 1)
  for (const r of db.activity) bump(r.event, "db")

  const seen = new Set<string>()
  let indexed = 0
  for (const log of chain.logs) {
    const k = `${log.txHash}:${log.logIndex}`
    const found = rows.get(k) ?? []
    if (!isIndexed(log)) {
      if (found.length > 0) add({ area: "activity", key: k, field: `row for unindexed ${log.eventName}`, db: found.map((f) => f.event).join(","), chain: "none expected" })
      continue
    }
    indexed++
    seen.add(k)
    const type = activityType(log)
    bump(type, "chain")
    if (found.length !== 1) {
      add({ area: "activity", key: k, field: `rows for ${log.eventName}`, db: String(found.length), chain: "1" })
      continue
    }
    const row = found[0]
    if (row.event !== type) add({ area: "activity", key: k, field: "event", db: row.event, chain: type })
    const created = epoch(row.created_at)
    if (created !== log.blockTimestamp) add({ area: "activity", key: k, field: "created_at (block timestamp)", db: `${row.created_at} (${str(created)})`, chain: str(log.blockTimestamp) })
    const price = expectedActivityPrice(log)
    if (price !== undefined && row.price !== price) add({ area: "activity", key: k, field: "price", db: str(row.price), chain: price })
  }
  for (const [k, list] of rows) {
    if (!seen.has(k)) add({ area: "activity", key: k, field: "row without an indexed log in range", db: list.map((r) => r.event).join(","), chain: "none" })
  }

  // ── collections ──────────────────────────────────────────────────────────
  const dbCols = new Map(db.collections.map((c) => [lc(c.contract_address), c]))
  for (const c of chain.collections) {
    const row = dbCols.get(c.address)
    if (!row) {
      add({ area: "collections", key: c.address, field: "row", db: "missing", chain: "registered" })
      continue
    }
    dbCols.delete(c.address)
    const vol = etherTextToWei(row.total_volume)
    if (vol !== c.volumeWei) add({ area: "collections", key: c.address, field: "total_volume (wei)", db: `${row.total_volume} (${vol})`, chain: c.volumeWei.toString() })
    if (Number(row.total_sales ?? 0) !== c.sales || (row.total_sales ?? "0").includes(".")) add({ area: "collections", key: c.address, field: "total_sales", db: str(row.total_sales), chain: String(c.sales) })
    if (!!row.is_verified !== c.verified) add({ area: "collections", key: c.address, field: "is_verified", db: str(row.is_verified), chain: String(c.verified) })
    if ((row.royalty_fee ?? 0) !== c.storedRoyaltyBps) add({ area: "collections", key: c.address, field: "royalty_fee (Core stored bps)", db: str(row.royalty_fee), chain: String(c.storedRoyaltyBps) })
    if (c.overridden) info.push(`collection ${c.address}: royalty override active on-chain (not modelled in the DB; the web quote reads it on-chain)`)
  }
  for (const [addr] of dbCols) add({ area: "collections", key: addr, field: "row", db: "present", chain: "not registered" })

  // ── listings (Core.listings 6-field struct) ──────────────────────────────
  const dbListings = new Map(db.listings.map((l) => [`${lc(l.collection_address)}-${l.token_id}`, l]))
  let listingsActive = 0
  let unmodelled = false
  for (const l of chain.listings) {
    const k = `${l.collection}-${l.tokenId}`
    const row = dbListings.get(k)
    const active = l.seller !== ZERO
    if (active) listingsActive++
    if (!row) {
      if (active) add({ area: "listings", key: k, field: "row", db: "missing", chain: "active" })
      continue
    }
    if (row.is_active !== active) {
      add({ area: "listings", key: k, field: "is_active", db: String(row.is_active), chain: String(active) })
      continue
    }
    if (!active) continue
    if (lc(row.seller_wallet) !== l.seller) add({ area: "listings", key: k, field: "seller", db: lc(row.seller_wallet), chain: l.seller })
    if (row.price !== l.price.toString()) add({ area: "listings", key: k, field: "price", db: row.price, chain: l.price.toString() })
    if (epoch(row.expires_at) !== l.expiresAt) add({ area: "listings", key: k, field: "expires_at", db: `${row.expires_at} (${str(epoch(row.expires_at))})`, chain: l.expiresAt.toString() })
    if (row.listed_at !== null && epoch(row.listed_at) !== l.listedAt) add({ area: "listings", key: k, field: "listed_at", db: `${row.listed_at}`, chain: l.listedAt.toString() })
    unmodelled = true
  }
  for (const [k, row] of dbListings) {
    if (!chain.listings.some((l) => `${l.collection}-${l.tokenId}` === k) && row.is_active) add({ area: "listings", key: k, field: "is_active", db: "true", chain: "never listed" })
  }
  if (unmodelled) info.push("listings: Core snapshots feeBps/royaltyBps per listing; the DB has no columns for them (decoded and not compared)")

  // ── token bids ───────────────────────────────────────────────────────────
  const activeTokenRows = new Map<string, DbTokenBid[]>()
  for (const b of db.tokenBids.filter((b) => b.is_active)) {
    const k = `${lc(b.collection_address)}-${b.token_id}-${lc(b.bidder_wallet)}`
    activeTokenRows.set(k, [...(activeTokenRows.get(k) ?? []), b])
  }
  let tokenBidsActive = 0
  for (const b of chain.tokenBids) {
    const k = `${b.collection}-${b.tokenId}-${b.bidder}`
    const rowsK = activeTokenRows.get(k) ?? []
    activeTokenRows.delete(k)
    const active = b.price > 0n
    if (active) tokenBidsActive++
    if (rowsK.length !== (active ? 1 : 0)) {
      add({ area: "token_bids", key: k, field: "active rows", db: String(rowsK.length), chain: active ? "1" : "0" })
      continue
    }
    if (!active) continue
    const row = rowsK[0]
    if (row.price !== b.price.toString()) add({ area: "token_bids", key: k, field: "price", db: row.price, chain: b.price.toString() })
    const exp = b.expiresAt === 0n ? null : b.expiresAt
    if (epoch(row.expires_at) !== exp) add({ area: "token_bids", key: k, field: "expires_at", db: str(row.expires_at), chain: str(exp) })
  }
  for (const [k, list] of activeTokenRows) add({ area: "token_bids", key: k, field: "active rows", db: String(list.length), chain: "slot never bid" })

  // ── collection bids ──────────────────────────────────────────────────────
  const activeColRows = new Map<string, DbCollectionBid[]>()
  for (const b of db.collectionBids.filter((b) => b.is_active)) {
    const k = `${lc(b.collection_address)}-${lc(b.bidder_wallet)}`
    activeColRows.set(k, [...(activeColRows.get(k) ?? []), b])
  }
  let collectionBidsActive = 0
  for (const b of chain.collectionBids) {
    const k = `${b.collection}-${b.bidder}`
    const rowsK = activeColRows.get(k) ?? []
    activeColRows.delete(k)
    const active = b.quantity > 0
    if (active) collectionBidsActive++
    if (rowsK.length !== (active ? 1 : 0)) {
      add({ area: "collection_bids", key: k, field: "active rows", db: String(rowsK.length), chain: active ? "1" : "0" })
      continue
    }
    if (!active) continue
    const row = rowsK[0]
    if (row.price !== b.pricePerItem.toString()) add({ area: "collection_bids", key: k, field: "price per item", db: row.price, chain: b.pricePerItem.toString() })
    if (Number(row.quantity) !== b.quantity) add({ area: "collection_bids", key: k, field: "remaining quantity", db: str(row.quantity), chain: String(b.quantity) })
    const exp = b.expiresAt === 0n ? null : b.expiresAt
    if (epoch(row.expires_at) !== exp) add({ area: "collection_bids", key: k, field: "expires_at", db: str(row.expires_at), chain: str(exp) })
  }
  for (const [k, list] of activeColRows) add({ area: "collection_bids", key: k, field: "active rows", db: String(list.length), chain: "slot never bid" })

  // ── nfts.owner_wallet vs ownerOf ─────────────────────────────────────────
  const dbNfts = new Map(db.nfts.map((n) => [`${lc(n.collection_address)}-${n.token_id}`, n]))
  for (const t of chain.tokens) {
    const k = `${t.collection}-${t.tokenId}`
    const row = dbNfts.get(k)
    dbNfts.delete(k)
    if (t.owner !== t.lastTransferTo) add({ area: "nfts", key: k, field: "ownerOf vs last Transfer (chain-internal)", db: t.lastTransferTo, chain: t.owner })
    if (!row) add({ area: "nfts", key: k, field: "row", db: "missing", chain: t.owner })
    else if (lc(row.owner_wallet) !== t.owner) add({ area: "nfts", key: k, field: "owner_wallet", db: lc(row.owner_wallet), chain: t.owner })
  }
  for (const [k, row] of dbNfts) add({ area: "nfts", key: k, field: "row", db: lc(row.owner_wallet), chain: "no Transfer seen" })

  return {
    atBlock: chain.atBlock,
    mismatches: out,
    info,
    counts: {
      logs: chain.logs.length,
      indexedLogs: indexed,
      activityRows: db.activity.length,
      perType,
      collections: chain.collections.length,
      listingsActive,
      tokenBidsActive,
      collectionBidsActive,
      nfts: chain.tokens.length,
    },
  }
}

/** activity.price the handlers store (exact wei text), where an event carries one. */
export function expectedActivityPrice(log: Pick<ChainLog, "eventName" | "args">): string | undefined {
  const a = log.args
  switch (log.eventName) {
    case "Sale":
    case "ListingCreated":
    case "TokenBidPlaced":
    case "TokenBidAccepted":
      return str(a.price)
    case "ListingUpdated":
      return str(a.newPrice)
    case "CollectionBidPlaced":
      return str(a.pricePerItem)
    case "CollectionBidAccepted":
      return str(a.totalPrice)
    case "Withdrawal":
      return str(a.amount)
    default:
      return undefined
  }
}

// ── collectors ──────────────────────────────────────────────────────────────

export interface ReconcileTarget {
  chainId: number
  pub: PublicClient
  db: SupabaseClient
  core: Address
  bids: Address
  router: Address
  fromBlock: bigint
  /** Defaults to indexer_state.last_block. */
  atBlock?: bigint
}

const LOG_CHUNK = 2_000n

async function getLogsChunked(pub: PublicClient, address: Address, abi: readonly unknown[], from: bigint, to: bigint): Promise<Log[]> {
  const out: Log[] = []
  for (let a = from; a <= to; a += LOG_CHUNK) {
    const b = a + LOG_CHUNK - 1n > to ? to : a + LOG_CHUNK - 1n
    out.push(...(await pub.getLogs({ address, events: abi as never, fromBlock: a, toBlock: b, strict: true } as never)))
  }
  return out
}

export async function readDbCursor(db: SupabaseClient, chainId: number): Promise<bigint | null> {
  const { data, error } = await db.from("indexer_state").select("last_block::text").eq("chain_id", chainId).maybeSingle()
  if (error) throw error
  const v = (data as { last_block: string | null } | null)?.last_block
  return v === null || v === undefined ? null : BigInt(v)
}

export async function collectChain(t: ReconcileTarget, atBlock: bigint): Promise<ChainSnapshot> {
  const { pub } = t
  const blockTs = new Map<bigint, bigint>()
  const ts = async (n: bigint) => {
    let v = blockTs.get(n)
    if (v === undefined) {
      v = (await pub.getBlock({ blockNumber: n })).timestamp
      blockTs.set(n, v)
    }
    return v
  }
  const toChainLog = async (source: ChainLog["source"], l: Log): Promise<ChainLog> => {
    const d = l as Log & { eventName: string; args: Record<string, unknown> }
    return {
      source,
      contract: lc(l.address),
      eventName: d.eventName,
      args: d.args,
      txHash: lc(l.transactionHash),
      logIndex: Number(l.logIndex),
      blockNumber: l.blockNumber!,
      blockTimestamp: await ts(l.blockNumber!),
    }
  }

  const logs: ChainLog[] = []
  for (const l of await getLogsChunked(pub, t.core, MarketplaceCoreEventsAbi, t.fromBlock, atBlock)) logs.push(await toChainLog("core", l))
  for (const l of await getLogsChunked(pub, t.bids, MarketplaceBidsEventsAbi, t.fromBlock, atBlock)) logs.push(await toChainLog("bids", l))

  // Registered collections, and their Transfers from the registration block on
  // (the indexer starts each collection's cursor at its registration block).
  const registrations = logs.filter((l) => l.eventName === "CollectionRegistered")
  const collections: ChainCollection[] = []
  const tokens: ChainToken[] = []
  const at = { blockNumber: atBlock }
  for (const r of registrations) {
    const address = getAddress(String(r.args.collection))
    const [volumeWei, sales, verified, exists] = (await pub.readContract({ address: t.router, abi: MarketplaceRouterAbi, functionName: "getCollectionStats", args: [address], ...at })) as readonly [bigint, number, boolean, boolean]
    const info = (await pub.readContract({ address: t.router, abi: MarketplaceRouterAbi, functionName: "collections", args: [address], ...at })) as { royaltyFee: number }
    const overridden = (await pub.readContract({ address: t.router, abi: MarketplaceRouterAbi, functionName: "royaltyOverridden", args: [address], ...at })) as boolean
    collections.push({ address: lc(address), registeredAtBlock: r.blockNumber, volumeWei, sales: Number(sales), verified, exists, storedRoyaltyBps: Number(info.royaltyFee), overridden })

    const transfers = await getLogsChunked(pub, address, Erc721TransferEventAbi, r.blockNumber, atBlock)
    const last = new Map<string, string>()
    for (const l of transfers) {
      const cl = await toChainLog("collection", l)
      logs.push(cl)
      last.set(String(cl.args.tokenId), lc(String(cl.args.to)))
    }
    for (const [tokenId, to] of last) {
      const owner = (await pub.readContract({
        address,
        abi: [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256", name: "id" }], outputs: [{ type: "address", name: "" }] }] as const,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
        ...at,
      })) as Address
      tokens.push({ collection: lc(address), tokenId, owner: lc(owner), lastTransferTo: to })
    }
  }

  // Every listing / bid slot that ever appeared, read at the pinned block.
  const uniq = <T>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()]
  const listingKeys = uniq(
    logs.filter((l) => l.eventName === "ListingCreated").map((l) => ({ c: getAddress(String(l.args.collection)), t: BigInt(String(l.args.tokenId)) })),
    (x) => `${x.c}-${x.t}`,
  )
  const listings: ChainListing[] = []
  for (const k of listingKeys) {
    const s = (await pub.readContract({ address: t.router, abi: MarketplaceRouterAbi, functionName: "listings", args: [k.c, k.t], ...at })) as { seller: Address; price: bigint; listedAt: number; expiresAt: number; feeBps: number; royaltyBps: number }
    listings.push({ collection: lc(k.c), tokenId: k.t.toString(), seller: lc(s.seller), price: s.price, listedAt: BigInt(s.listedAt), expiresAt: BigInt(s.expiresAt), feeBps: Number(s.feeBps), royaltyBps: Number(s.royaltyBps) })
  }

  const tokenBidKeys = uniq(
    logs.filter((l) => l.eventName === "TokenBidPlaced").map((l) => ({ c: getAddress(String(l.args.collection)), t: BigInt(String(l.args.tokenId)), b: getAddress(String(l.args.bidder)) })),
    (x) => `${x.c}-${x.t}-${x.b}`,
  )
  const tokenBids: ChainTokenBid[] = []
  for (const k of tokenBidKeys) {
    const s = (await pub.readContract({ address: t.router, abi: MarketplaceRouterAbi, functionName: "tokenBids", args: [k.c, k.t, k.b], ...at })) as { price: bigint; expiresAt: bigint }
    tokenBids.push({ collection: lc(k.c), tokenId: k.t.toString(), bidder: lc(k.b), price: s.price, expiresAt: BigInt(s.expiresAt) })
  }

  const colBidKeys = uniq(
    logs.filter((l) => l.eventName === "CollectionBidPlaced").map((l) => ({ c: getAddress(String(l.args.collection)), b: getAddress(String(l.args.bidder)) })),
    (x) => `${x.c}-${x.b}`,
  )
  const collectionBids: ChainCollectionBid[] = []
  for (const k of colBidKeys) {
    const s = (await pub.readContract({ address: t.router, abi: MarketplaceRouterAbi, functionName: "collectionBids", args: [k.c, k.b], ...at })) as { pricePerItem: bigint; quantity: number; expiresAt: bigint }
    collectionBids.push({ collection: lc(k.c), bidder: lc(k.b), pricePerItem: s.pricePerItem, quantity: Number(s.quantity), expiresAt: BigInt(s.expiresAt) })
  }

  return { atBlock, logs, collections, listings, tokenBids, collectionBids, tokens }
}

async function selectAll<T>(db: SupabaseClient, table: string, columns: string, chainId: number): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).eq("chain_id", chainId).order("id").range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) return out
  }
}

export async function collectDb(db: SupabaseClient, chainId: number): Promise<DbSnapshot> {
  return {
    lastBlock: await readDbCursor(db, chainId),
    activity: await selectAll<DbActivity>(db, "activity", "event,tx_hash,log_index::text,created_at,collection_address,token_id,price,chain_id", chainId),
    collections: await selectAll<DbCollection>(db, "collections", "contract_address,total_volume::text,total_sales::text,is_verified,royalty_fee", chainId),
    listings: await selectAll<DbListing>(db, "listings", "collection_address,token_id,seller_wallet,price::text,is_active,expires_at,listed_at", chainId),
    tokenBids: await selectAll<DbTokenBid>(db, "token_bids", "collection_address,token_id,bidder_wallet,price::text,is_active,expires_at", chainId),
    collectionBids: await selectAll<DbCollectionBid>(db, "collection_bids", "collection_address,bidder_wallet,price::text,quantity::text,is_active,expires_at", chainId),
    nfts: await selectAll<DbNft>(db, "nfts", "collection_address,token_id,owner_wallet", chainId),
  }
}

export async function reconcile(t: ReconcileTarget): Promise<ReconcileReport> {
  const atBlock = t.atBlock ?? (await readDbCursor(t.db, t.chainId))
  if (atBlock === null || atBlock === undefined) throw new Error(`no indexer_state row for chain ${t.chainId}`)
  const db = await collectDb(t.db, t.chainId)
  const chain = await collectChain(t, atBlock)
  return diff(chain, db)
}

export function formatReport(r: ReconcileReport): string {
  const lines = [`reconciliation at block ${r.atBlock}: ${r.mismatches.length} mismatch(es)`]
  const c = r.counts
  lines.push(`  logs ${c.logs} (indexed ${c.indexedLogs}), activity rows ${c.activityRows}, collections ${c.collections}, active listings ${c.listingsActive}, active token bids ${c.tokenBidsActive}, active collection bids ${c.collectionBidsActive}, nfts ${c.nfts}`)
  for (const [type, v] of Object.entries(c.perType).sort()) lines.push(`  ${v.chain === v.db ? " " : "!"} ${type.padEnd(28)} chain ${String(v.chain).padStart(4)}  db ${String(v.db).padStart(4)}`)
  for (const m of r.mismatches) lines.push(`  MISMATCH ${m.area} ${m.key} ${m.field}: db=${m.db} chain=${m.chain}`)
  for (const i of r.info) lines.push(`  info: ${i}`)
  return lines.join("\n")
}

export type { Hex }
