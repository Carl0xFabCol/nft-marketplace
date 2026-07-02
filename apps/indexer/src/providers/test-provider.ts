#!/usr/bin/env tsx
/**
 * Test script for the provider layer.
 * Run with: npx tsx src/providers/test-provider.ts
 */

import { ProviderFactory } from "./ProviderFactory"
import { ProviderPool } from "./ProviderPool"
import { logger } from "../utils/logger"

async function testProviders() {
  logger.info("🧪 Testing Provider Layer...")

  // Initialize the factory
  ProviderFactory.initialize()

  // Get the fast provider
  const fastProvider = ProviderFactory.getFastProvider()
  logger.info({ provider: fastProvider.name }, "✅ Fast provider retrieved")

  // Get current block number
  try {
    const blockNumber = await fastProvider.getBlockNumber()
    logger.info({ blockNumber: blockNumber.toString() }, "✅ Current block number fetched")
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "❌ Failed to get block number")
  }

  // Test provider pool
  const pool = new ProviderPool()

  // Execute with fallback
  try {
    const result = await pool.executeWithFallback(async (provider) => {
      return await provider.getBlockNumber()
    })

    logger.info({ blockNumber: result?.toString() }, "✅ Provider pool execution successful")
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "❌ Provider pool execution failed")
  }

  // Health check
  const health = await pool.checkHealth()
  logger.info({ health }, "✅ Health check complete")

  logger.info("🎉 Provider layer test complete!")
}

testProviders().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, "❌ Test failed")
  process.exit(1)
})
