#!/usr/bin/env npx tsx

/**
 * Backfill `image_url` for NFTs that have a `token_uri` but no `image_url`.
 *
 * Run with: pnpm --filter @marketplace/indexer backfill:image-urls
 *
 * Useful when the indexer's MetadataFetcher failed at index time (IPFS
 * gateway down, invalid JSON, timeout) so the `nfts` row was created with
 * `image_url: null` even though `token_uri` points at an IPFS URI.
 *
 * The script is idempotent: it skips rows that already have an `image_url`,
 * and only updates rows where metadata can be re-fetched successfully.
 *
 * Only `token_uri`, `image_url`, `metadata` and `last_synced` are updated —
 * `owner_wallet` is never touched.
 *
 * Optionally pass a collection address to backfill just that collection:
 *   pnpm --filter @marketplace/indexer backfill:image-urls 0xabc...
 */

import "dotenv/config"
import { createPublicClient, http, type Address } from "viem"
import type { SupabaseClient } from "@supabase/supabase-js"
import { env } from "../config/env"
import { supabase as rawSupabase } from "../supabase"
import { getViemChain } from "../providers/chains"
import { ViemRpcProvider } from "../providers/ViemRpcProvider"
import { MetadataFetcher } from "../fetchers/MetadataFetcher"
import { logger } from "../utils/logger"

const BATCH = 50

const supabase: SupabaseClient = rawSupabase as unknown as SupabaseClient

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
    name: "backfill-image-urls",
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

  logger.info({ chainId: env.chainId, onlyCollection }, "🖼️  Starting image_url backfill")

  let offset = 0
  let totalProcessed = 0
  let totalUpdated = 0
  let totalSkipped = 0

  for (;;) {
    let query = supabase
      .from("nfts")
      .select("collection_address, token_id, token_uri, chain_id")
      .is("image_url", null)
      .not("token_uri", "is", null)
      .eq("chain_id", env.chainId)
      .order("collection_address", { ascending: true })
      .order("token_id", { ascending: true })
      .range(offset, offset + BATCH - 1)

    if (onlyCollection) {
      query = query.eq("collection_address", onlyCollection)
    }

    const { data, error } = await query

    if (error) {
      throw error
    }

    const rows = (data ?? []) as Array<{
      collection_address: string
      token_id: string
      token_uri: string
      chain_id: number
    }>

    if (rows.length === 0) break

    logger.info({ batch: offset / BATCH + 1, count: rows.length }, "📦 Processing batch")

    for (const row of rows) {
      const contractAddress = row.collection_address as Address
      const tokenId = row.token_id

      try {
        const nftData = await metadataFetcher.getNFTData(contractAddress, tokenId)

        if (!nftData.imageUrl) {
          totalSkipped++
          logger.debug(
            { contractAddress, tokenId, tokenUri: row.token_uri },
            "⚠️  No image URL resolvable, skipping",
          )
          continue
        }

        const { error: updateError } = await supabase
          .from("nfts")
          .update({
            token_uri: nftData.tokenUri ?? row.token_uri,
            image_url: nftData.imageUrl,
            metadata: nftData.metadata,
            last_synced: new Date(),
          })
          .eq("collection_address", contractAddress.toLowerCase())
          .eq("token_id", tokenId)
          .eq("chain_id", row.chain_id)

        if (updateError) {
          throw updateError
        }

        totalUpdated++
        logger.info({ contractAddress, tokenId, imageUrl: nftData.imageUrl }, "✅ image_url backfilled")
      } catch (error) {
        totalSkipped++
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            contractAddress: row.collection_address,
            tokenId: row.token_id,
          },
          "❌ Failed to backfill image_url",
        )
      }
    }

    totalProcessed += rows.length
    offset += BATCH
  }

  logger.info(
    { totalProcessed, totalUpdated, totalSkipped },
    "🎉 image_url backfill complete",
  )
}

main().catch((error) => {
  logger.error(
    { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
    "❌ image_url backfill failed",
  )
  process.exit(1)
})
