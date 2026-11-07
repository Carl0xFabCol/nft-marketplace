// ─────────────────────────────────────────────────────────────────────────────
// Test harness: the real handlers + real repositories + real HandlerRegistry,
// wired exactly like src/index.ts, over a recording fake supabase client.
// Test files must vi.mock("../config/env") (or the equivalent relative path)
// BEFORE importing this module, because handlers read env at import time.
// ─────────────────────────────────────────────────────────────────────────────
import type { Address } from "viem"
import { ActivityRepository } from "../persistence/ActivityRepository"
import { BidsRepository } from "../persistence/BidsRepository"
import { CollectionsRepository } from "../persistence/CollectionsRepository"
import { ListingsRepository } from "../persistence/ListingsRepository"
import { NFTRepository } from "../persistence/NFTRepository"
import { HandlerRegistry } from "../handlers/HandlerRegistry"
import { createCoreEventHandlers } from "../handlers/CoreEventHandler"
import { createBidsEventHandlers } from "../handlers/BidsEventHandler"
import { createTransferHandler } from "../handlers/TransferHandler"
import type { ParsedEvent } from "../types/indexer.types"
import { createRecordingSupabase, type Responder } from "./recordingSupabase"

export const COLLECTION = "0xd71331443968a9d958a5c5089cf74051f7b9d7e2" as Address
export const SELLER = "0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294" as Address
export const BUYER = "0x373cdd612de9857dea8ca360efc302405dd82860" as Address
export const TS = 1790000000

export const stubMetadataFetcher = {
  getCollectionMetadata: async () => ({ name: "Test", symbol: "TST" }),
  getNFTData: async () => ({ tokenUri: null, imageUrl: null, metadata: null }),
}

export function buildHarness(responder?: Responder) {
  return wireHarness(createRecordingSupabase(responder))
}

/** Same wiring over an existing recording client (e.g. createMemoryDb().sb). */
export function wireHarness(sb: ReturnType<typeof createRecordingSupabase>) {
  const activityRepo = new ActivityRepository(sb.client)
  const collectionsRepo = new CollectionsRepository(sb.client)
  const listingsRepo = new ListingsRepository(sb.client)
  const bidsRepo = new BidsRepository(sb.client)
  const nftRepo = new NFTRepository(sb.client)
  const metadata = stubMetadataFetcher as never
  const registry = new HandlerRegistry()
  registry.registerAll([
    ...createCoreEventHandlers(activityRepo, collectionsRepo, listingsRepo, nftRepo, metadata),
    ...createBidsEventHandlers(activityRepo, bidsRepo, collectionsRepo, listingsRepo, nftRepo, metadata),
    createTransferHandler(activityRepo, nftRepo, metadata),
  ])
  return { sb, registry, activityRepo, collectionsRepo, listingsRepo, bidsRepo, nftRepo }
}

let autoLogIndex = 0

export function makeEvent<T>(
  contractName: string,
  eventName: string,
  args: T,
  opts: { block?: bigint; logIndex?: number; tx?: `0x${string}`; timestamp?: number } = {},
): ParsedEvent<T> {
  return {
    contractName,
    contractAddress: "0x0000000000000000000000000000000000000001" as Address,
    eventName,
    args,
    blockNumber: opts.block ?? 100n,
    blockTimestamp: opts.timestamp ?? TS,
    transactionHash: opts.tx ?? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: opts.logIndex ?? autoLogIndex++,
    raw: {} as never,
  }
}
