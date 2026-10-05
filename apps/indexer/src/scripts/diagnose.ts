#!/usr/bin/env npx tsx

/**
 * Diagnostic script to verify the indexer can connect to Sepolia and fetch events.
 * Run with: npx tsx src/scripts/diagnose.ts
 *
 * This script will:
 * 1. Check RPC connectivity
 * 2. Fetch recent events from each contract in 10-block chunks (Alchemy free tier limit)
 * 3. Verify event names match the ABI
 * 4. Output detailed diagnostics
 */

import "dotenv/config"
import { createPublicClient, http } from "viem"
import { CONTRACTS_TO_INDEX } from "../config/contracts.config"
import { env } from "../config/env"
import { logger } from "../utils/logger"
import { getViemChain } from "../providers/chains"

// Override log level for script
process.env.LOG_LEVEL = "debug"

// Alchemy free tier limit for eth_getLogs
const ALCHEMY_FREE_BLOCK_LIMIT = 10

const client = createPublicClient({
  chain: getViemChain(env.chainId),
  transport: http(env.fastRpcUrl, {
    timeout: 30_000,
  }),
})

/**
 * Chunk a block range into smaller chunks respecting the block limit
 */
function chunkBlocks(fromBlock: bigint, toBlock: bigint, chunkSize: number): Array<{ from: bigint; to: bigint }> {
  const chunks: Array<{ from: bigint; to: bigint }> = []
  let currentFrom = fromBlock
  while (currentFrom <= toBlock) {
    const currentTo = currentFrom + BigInt(chunkSize) - 1n
    chunks.push({
      from: currentFrom,
      to: currentTo > toBlock ? toBlock : currentTo,
    })
    currentFrom = currentTo + 1n
  }
  return chunks
}

async function diagnose() {
  logger.info({ chainId: env.chainId }, "🔬 Starting indexer diagnostics...")

  // 1. Check RPC connectivity
  logger.info("📡 Checking RPC connectivity...")
  try {
    const blockNumber = await client.getBlockNumber()
    logger.info({ blockNumber: blockNumber.toString() }, "✅ RPC connected successfully")
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "❌ RPC connection failed - check FAST_RPC_URL")
    process.exit(1)
  }

  // Check last ~100 blocks to find any events
  const currentBlock = await client.getBlockNumber()
  const fromBlock = currentBlock - 99n
  const toBlock = currentBlock

  logger.info(
    {
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      blockRange: (toBlock - fromBlock + 1n).toString(),
      chunkSize: ALCHEMY_FREE_BLOCK_LIMIT,
    },
    "🔍 Fetching events in 10-block chunks",
  )

  // 2. Check each contract
  const totalEventsFound: Record<string, number> = {}

  for (const contract of CONTRACTS_TO_INDEX) {
    logger.info({ contract: contract.name, address: contract.address }, "🔷 Checking contract...")
    totalEventsFound[contract.name] = 0

    // Check if we have specific events to fetch
    if (contract.events && contract.events.length > 0) {
      logger.info({ events: contract.events }, "📋 Configured event types")

      // Fetch each event type
      for (const eventName of contract.events) {
        let totalFound = 0
        const chunks = chunkBlocks(fromBlock, toBlock, ALCHEMY_FREE_BLOCK_LIMIT)

        // Process chunks sequentially to respect rate limits
        for (const chunk of chunks) {
          try {
            logger.debug(
              {
                contract: contract.name,
                eventName,
                chunkFrom: chunk.from.toString(),
                chunkTo: chunk.to.toString(),
              },
              "📡 Fetching chunk",
            )
            const events = await client.getContractEvents({
              address: contract.address,
              abi: contract.abi,
              fromBlock: chunk.from,
              toBlock: chunk.to,
              eventName,
            })

            totalFound += events.length
          } catch (error) {
            // Log only first error to avoid spam
            if (totalFound === 0) {
              const errorMessage = error instanceof Error ? error.message : String(error)
              logger.error(
                {
                  contract: contract.name,
                  eventName,
                  error: errorMessage,
                },
                `❌ Failed to fetch ${eventName} events`,
              )
            }
          }
        }

        if (totalFound > 0) {
          logger.info(
            {
              contract: contract.name,
              eventName,
              count: totalFound,
            },
            `✅ Found ${totalFound} ${eventName} events`,
          )
          totalEventsFound[contract.name] += totalFound
        } else {
          logger.info({ contract: contract.name, eventName }, `ℹ️ No ${eventName} events found in last ${chunks.length} chunks`)
        }
      }
    } else {
      logger.warn({ contract: contract.name }, "⚠️ No specific events configured for this contract")
    }
  }

  // 3. Verify event signatures match ABI
  logger.info("🔐 Verifying event signatures in ABI...")
  for (const contract of CONTRACTS_TO_INDEX) {
    const eventAbis = contract.abi.filter((item: any) => item.type === "event")
    const configuredEvents = contract.events ?? []

    const abiEvents = eventAbis.map((e: any) => e.name)
    const missingInAbi = configuredEvents.filter((e) => !abiEvents.includes(e))
    const missingInConfig = abiEvents.filter((ae: string) => !configuredEvents.includes(ae))

    if (missingInAbi.length > 0) {
      logger.warn({ contract: contract.name, missing: missingInAbi }, "⚠️ Events configured but not in ABI - will fail to decode")
    }
    if (missingInConfig.length > 0) {
      logger.info({ contract: contract.name, events: missingInConfig }, "ℹ️ Events in ABI but not configured - will be ignored")
    }
    logger.info(
      {
        contract: contract.name,
        configured: configuredEvents.length,
        available: abiEvents.length,
        totalFound: totalEventsFound[contract.name],
      },
      "📊 Event configuration summary",
    )
  }

  // 4. Summary
  const totalAll = Object.values(totalEventsFound).reduce((a, b) => a + b, 0)
  if (totalAll === 0) {
    logger.warn(
      {
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
      },
      "⚠️ No events found in the checked range. This could mean: (1) No events in this period, (2) Wrong contract addresses, (3) ABI mismatch, (4) Indexer state is ahead of current blocks",
    )
  } else {
    logger.info({ totalEvents: totalAll }, "✅ Total events found across all contracts")
  }

  logger.info("✅ Diagnostics complete!")
}

diagnose().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, "💥 Diagnostic script failed")
  process.exit(1)
})
