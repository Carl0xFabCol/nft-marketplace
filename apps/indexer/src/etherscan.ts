import "dotenv/config"
import { CHAIN_IDS } from "@marketplace/shared"
import { env } from "./config/env"

// Chains Etherscan's V2 API is known to support. Brand-new/custom chains like
// Elysium (chain id 99801) are NOT recognized by Etherscan, so lookups for
// those chains are skipped gracefully instead of failing.
const ETHERSCAN_SUPPORTED_CHAIN_IDS: number[] = [CHAIN_IDS.SEPOLIA, CHAIN_IDS.MAINNET]

interface EtherscanResponse {
  status: string
  message: string
  result: Array<{
    contractAddress: string
    contractCreator: string
    txHash: string
    blockNumber: string
  }>
}

/**
 * Obtains the deployment block of a contract using Etherscan API V2
 * @param contractAddress - Contract address
 * @returns Block number or null if not found
 */
export const getDeploymentBlock = async (contractAddress: string): Promise<number | null> => {
  try {
    const chainId = env.chainId

    if (!ETHERSCAN_SUPPORTED_CHAIN_IDS.includes(chainId)) {
      console.warn(`⚠️ Etherscan does not support chainId ${chainId} (e.g. Elysium) — skipping deploy-block lookup. Configure DEPLOY_BLOCK manually if needed.`)
      return null
    }

    const apiKey = process.env.ETHERSCAN_API_KEY
    if (!apiKey) {
      console.error("ETHERSCAN_API_KEY no está configurada en .env")
      return null
    }

    // ⚠️ IMPORTANT: Use API V2 with chainid
    const baseUrl = "https://api.etherscan.io/v2/api"

    const url = `${baseUrl}?chainid=${chainId}&module=contract&action=getcontractcreation&contractaddresses=${contractAddress}&apikey=${apiKey}`

    console.log(`🔍 Searching deployment block for ${contractAddress}...`)

    const response = await fetch(url)
    const data = (await response.json()) as EtherscanResponse

    if (data.status !== "1") {
      console.error(`Etherscan error: ${data.message} - ${data.result}`)
      return null
    }

    if (!data.result || data.result.length === 0) {
      console.warn(`Data not found for ${contractAddress}`)
      return null
    }

    const creationInfo = data.result[0]
    const blockNumber = parseInt(creationInfo.blockNumber, 10)

    console.log(`✅ Contract deployed at ${blockNumber}`)
    console.log(`   Deployer: ${creationInfo.contractCreator}`)
    console.log(`   Tx Hash: ${creationInfo.txHash}`)

    return blockNumber
  } catch (error) {
    console.error("Error in getDeploymentBlock:", error)
    return null
  }
}

const deploymentBlockCache = new Map<string, number | null>()

export const getDeploymentBlockCached = async (contractAddress: string): Promise<number | null> => {
  const normalizedAddress = contractAddress.toLowerCase()

  if (deploymentBlockCache.has(normalizedAddress)) {
    return deploymentBlockCache.get(normalizedAddress) ?? null
  }

  const block = await getDeploymentBlock(contractAddress)
  deploymentBlockCache.set(normalizedAddress, block)
  return block
}
