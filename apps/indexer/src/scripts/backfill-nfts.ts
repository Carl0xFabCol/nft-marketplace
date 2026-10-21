#!/usr/bin/env npx tsx

/**
 * Backfill the `nfts` table from on-chain ERC721 Transfer logs.
 *
 * Run with: pnpm --filter @marketplace/indexer backfill
 *
 * Useful when Transfer events were indexed into `activity` before the NFT
 * insert fallback existed (so no `nfts` rows were created), or when the
 * indexer started after a collection had already been minted.
 *
 * The script is idempotent: it derives the current owner + mint timestamp for
 * every token from the chain and upserts each NFT with its metadata.
 *
 * Optionally pass a collection address to backfill just that collection:
 *   pnpm --filter @marketplace/indexer backfill 0xabc...
 */

import "dotenv/config"
import { createPublicClient, erc721Abi, http, type Address } from "viem"
import { env } from "../config/env"
import { supabase } from "../supabase"
import { getViemChain } from "../providers/chains"
import { ViemRpcProvider } from "../providers/ViemRpcProvider"
import { MetadataFetcher } from "../fetchers/MetadataFetcher"
import { CollectionsRepository } from "../persistence/CollectionsRepository"
import { NFTRepository } from "../persistence/NFTRepository"
import { BlockRangeUtil } from "../utils/BlockRange"
import { ZERO_ADDRESS } from "@marketplace/shared"
import { logger } from "../utils/logger"

const ZERO = ZERO_ADDRESS.toLowerCase()

interface TokenState {
  owner: Address
  mintedAt: Date | null
  burned: boolean
}

async function main() {
  const onlyCollection = process.argv[2]?.toLowerCase()

  const headers = env.conduitApiKey
    ? { "X-API-Key": env.conduitApiKey }
    : env.fastRpcToken
      ? { "X-API-Key": env.fastRpcToken }
      : undefined

  const client = createPublicClient({
    chain: getViemChain(env.chainId),
    transport: http(env.fastRpcUrl, { timeout: 30_000, ...(headers && { fetchOptions: { headers } }) }),
  })

  const provider = new ViemRpcProvider({
    name: "backfill",
    url: env.fastRpcUrl,
    type: "fast",
    chainId: env.chainId,
    ...(headers && { headers }),
  })

  const providerChainId = await provider.getChainId()
  if (providerChainId !== env.chainId) {
    throw new Error(`RPC chain id ${providerChainId} does not match CHAIN_ID=${env.chainId}`)
  }

  const metadataFetcher = new MetadataFetcher(provider)
  const collectionsRepo = new CollectionsRepository(supabase)
  const nftRepo = new NFTRepository(supabase)

  const head = await provider.getBlockNumber()
  logger.info({ head: head.toString(), chainId: env.chainId }, "🔁 Starting NFT backfill")

  const collections = (await collectionsRepo.getAll(env.chainId)).filter(
    (c) => !onlyCollection || String(c.contract_address).toLowerCase() === onlyCollection,
  )

  if (collections.length === 0) {
    logger.warn({ chainId: env.chainId, onlyCollection }, "⚠️  No matching collections found")
    return
  }

  const blockTimestampCache = new Map<string, Date>()

  const getBlockTimestamp = async (blockNumber: bigint): Promise<Date> => {
    const key = blockNumber.toString()
    const cached = blockTimestampCache.get(key)
    if (cached) return cached

    const block = await client.getBlock({ blockNumber })
    const date = new Date(Number(block.timestamp) * 1000)
    blockTimestampCache.set(key, date)
    return date
  }

  let totalUpserted = 0

  for (const collection of collections) {
    const contractAddress = collection.contract_address as Address
    const indexerBlock = BigInt(Number(collection.indexer_block ?? 0))

    logger.info({ contractAddress, fromBlock: indexerBlock.toString(), toBlock: head.toString() }, "🔎 Scanning collection")

    const ranges = BlockRangeUtil.chunk(indexerBlock, head, env.batchSize)
    const logs: Array<{
      blockNumber: bigint
      logIndex: number
      blockTimestamp?: bigint | null
      args: { from?: Address; to?: Address; tokenId?: bigint }
    }> = []

    for (const range of ranges) {
      const chunk = await client.getContractEvents({
        address: contractAddress,
        abi: erc721Abi,
        eventName: "Transfer",
        fromBlock: range.from,
        toBlock: range.to,
      })
      logs.push(...chunk)
    }

    logs.sort((a, b) => {
      const blockDiff = Number(a.blockNumber - b.blockNumber)
      return blockDiff !== 0 ? blockDiff : a.logIndex - b.logIndex
    })

    const tokens = new Map<string, TokenState>()

    for (const log of logs) {
      const { from, to, tokenId } = log.args
      if (from === undefined || to === undefined || tokenId === undefined) continue

      const id = tokenId.toString()
      const timestamp = log.blockTimestamp
        ? new Date(Number(log.blockTimestamp) * 1000)
        : await getBlockTimestamp(log.blockNumber)

      if (String(from).toLowerCase() === ZERO) {
        tokens.set(id, { owner: to as Address, mintedAt: timestamp, burned: false })
        continue
      }

      const existing = tokens.get(id)
      if (String(to).toLowerCase() === ZERO) {
        tokens.set(id, { owner: ZERO as Address, mintedAt: existing?.mintedAt ?? null, burned: true })
      } else {
        tokens.set(id, { owner: to as Address, mintedAt: existing?.mintedAt ?? null, burned: false })
      }
    }

    logger.info({ contractAddress, transfers: logs.length, tokens: tokens.size }, "📦 Rebuilt token owners")

    for (const [tokenId, state] of tokens) {
      const nftData = await metadataFetcher.getNFTData(contractAddress, tokenId)

      await nftRepo.upsert({
        collectionAddress: contractAddress,
        tokenId,
        ownerWallet: state.owner,
        lastSynced: state.mintedAt ?? new Date(),
        chainId: env.chainId,
        tokenUri: nftData.tokenUri,
        imageUrl: nftData.imageUrl,
        metadata: nftData.metadata,
        mintedAt: state.mintedAt,
      })

      totalUpserted++
      logger.info(
        { contractAddress, tokenId, owner: state.owner, burned: state.burned, hasMetadata: !!nftData.metadata },
        "✅ NFT upserted",
      )
    }
  }

  logger.info({ totalUpserted, collections: collections.length }, "🎉 NFT backfill complete")
}

main().catch((error) => {
  logger.error(
    { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
    "❌ NFT backfill failed",
  )
  process.exit(1)
})
