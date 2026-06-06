import "dotenv/config"
import { createPublicClient, decodeEventLog, erc721Abi, http, Address } from "viem"
import { sepolia } from "viem/chains"
import { CHAIN_IDS } from "@marketplace/shared"
import { supabase } from "./supabase"
import { getDeploymentBlockCached as getDeploymentBlock } from "./etherscan"
import { BIDS_CONTRACT_ADDRESS, CORE_CONTRACT_ADDRESS, MarketplaceBidsABI, MarketplaceCoreABI } from "./contracts"

export const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL!),
})

let running = false
let runs = 0

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE CONTRATOS A INDEXAR (SOLO Core y Bids)
// ═══════════════════════════════════════════════════════════════════════════════

const CONTRACTS_TO_INDEX = [
  {
    name: "core",
    address: CORE_CONTRACT_ADDRESS as Address,
    abi: MarketplaceCoreABI,
    events: [
      // Collection events
      "CollectionRegistered",
      "CollectionVerified",
      "ContractAuthorized",
      // Listing events
      "ListingCreated",
      "ListingUpdated",
      "ListingCancelled",
      // Sale events
      "Sale",
      // Admin events
      "MarketplaceFeeUpdated",
      "FeeReceiverUpdated",
      "OwnershipTransferred",
      "Paused",
      "Unpaused",
    ],
  },
  {
    name: "bids",
    address: BIDS_CONTRACT_ADDRESS as Address,
    abi: MarketplaceBidsABI,
    events: [
      // Collection bid events
      "CollectionBidPlaced",
      "CollectionBidAccepted",
      "CollectionBidCancelled",
      // Token bid events
      "TokenBidPlaced",
      "TokenBidAccepted",
      "TokenBidCancelled",
      // Admin events
      "Paused",
      "Unpaused",
    ],
  },
]

// NOTA: MarketplaceABI NO se indexa porque NO TIENE EVENTOS

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function getTokenURI(contract: Address, tokenId: string) {
  try {
    return await client.readContract({
      address: contract,
      abi: erc721Abi,
      functionName: "tokenURI",
      args: [BigInt(tokenId)],
    })
  } catch {
    return null
  }
}

async function fetchMetadata(uri: string): Promise<any> {
  if (!uri) return null

  if (uri.startsWith("ipfs://")) {
    uri = uri.replace("ipfs://", "https://ipfs.io/ipfs/")
  }

  const res = await fetch(uri)
  return res.json()
}

async function getCollectionMetadata(collectionAddress: Address) {
  try {
    const [name, symbol] = await Promise.all([
      client
        .readContract({
          address: collectionAddress,
          abi: erc721Abi,
          functionName: "name",
        })
        .catch(() => "Unknown"),
      client
        .readContract({
          address: collectionAddress,
          abi: erc721Abi,
          functionName: "symbol",
        })
        .catch(() => "UNKNOWN"),
    ])

    return { name, symbol }
  } catch (error) {
    console.error(`Error getting metadata for ${collectionAddress}:`, error)
    return { name: "Unknown", symbol: "UNKNOWN" }
  }
}

async function upsertNFT(collectionAddress: string, tokenId: string, ownerWallet: string, timestamp: number) {
  const tokenUri = await getTokenURI(collectionAddress as Address, tokenId)
  const meta = tokenUri ? await fetchMetadata(tokenUri) : null

  let image = meta?.image
  if (image?.startsWith("ipfs://")) {
    image = image.replace("ipfs://", "https://ipfs.io/ipfs/")
  }

  const { error } = await supabase.from("nfts").upsert(
    {
      collection_address: collectionAddress.toLowerCase(),
      token_id: tokenId,
      owner_wallet: ownerWallet.toLowerCase(),
      last_synced: new Date(timestamp * 1000),
      chain_id: sepolia.id,

      token_uri: tokenUri,
      image_url: image,
      metadata: meta,
    },
    { onConflict: "collection_address,token_id,chain_id" },
  )

  if (error) console.error("NFT UPSERT ERROR", error)
}

async function insertNFT(collectionAddress: string, tokenId: string, ownerWallet: string, timestamp: number) {
  const metadata = await getCollectionMetadata(collectionAddress as Address)
  console.log(collectionAddress, tokenId, ownerWallet, timestamp, metadata)
  const { data, error } = await supabase.from("nfts").insert({
    collection_address: collectionAddress.toLowerCase(),
    token_id: tokenId,
    owner_wallet: ownerWallet.toLowerCase(),
    last_synced: new Date(timestamp * 1000),
    chain_id: sepolia.id,
    name: metadata.name,
    symbol: metadata.symbol,
  })
  if (error) console.error("INSERT ERROR:", error)
}

async function insertActivity(params: {
  event: string
  collectionAddress: string
  tokenId?: string
  from?: string
  to?: string
  price?: string
  quantity?: number
  txHash: string
  createdAt: Date
  logIndex: number
  sourceContract: string
}) {
  await supabase.from("activity").insert({
    event: params.event,
    collection_address: params.collectionAddress.toLowerCase(),
    token_id: params.tokenId,
    from: params.from?.toLowerCase(),
    to: params.to?.toLowerCase(),
    price: params.price,
    quantity: params.quantity,
    tx_hash: params.txHash.toLowerCase(),
    created_at: params.createdAt,
    log_index: params.logIndex,
    source_contract: params.sourceContract,
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS (actualizados para Core y Bids)
// ═══════════════════════════════════════════════════════════════════════════════

const eventHandlers: Record<string, (ev: any, args: any, source: string) => Promise<void>> = {
  // ───── CORE EVENTS ─────
  CollectionRegistered: async (ev, args, source) => {
    const { collection, owner, royaltyFee, isVerified } = args

    const deployBlock = await getDeploymentBlock(collection as Address)
    const metadata = await getCollectionMetadata(collection as Address)

    await supabase.from("collections").upsert(
      {
        contract_address: String(collection).toLowerCase(),
        chain_id: CHAIN_IDS.SEPOLIA,
        creator_wallet: String(owner).toLowerCase(),
        name: metadata.name,
        symbol: metadata.symbol,
        royalty_fee: Number(royaltyFee),
        is_verified: Boolean(isVerified),
        deployed_at: deployBlock,
        indexer_block: deployBlock,
        created_at: new Date(Number(ev.blockTimestamp) * 1000),
        updated_at: new Date(Number(ev.blockTimestamp) * 1000),
      },
      {
        onConflict: "contract_address",
      },
    )

    await insertActivity({
      event: "COLLECTION_REGISTERED",
      collectionAddress: String(collection),
      from: String(owner),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  CollectionVerified: async (ev, args, source) => {
    const { collection } = args

    await supabase
      .from("collections")
      .update({
        is_verified: true,
        updated_at: new Date(Number(ev.blockTimestamp) * 1000),
      })
      .eq("contract_address", String(collection).toLowerCase())

    await insertActivity({
      event: "COLLECTION_VERIFIED",
      collectionAddress: String(collection),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  ListingCreated: async (ev, args, source) => {
    const { collection, tokenId, seller, price, expiresAt } = args

    await supabase.from("listings").upsert(
      {
        listing_id: `${collection.toLowerCase()}-${tokenId}`,
        collection_address: String(collection).toLowerCase(),
        token_id: tokenId?.toString(),
        seller_wallet: String(seller).toLowerCase(),
        price: Number(price),
        expires_at: expiresAt && Number(expiresAt) > 0 ? new Date(Number(expiresAt) * 1000) : null,
        is_active: true,
        tx_hash: String(ev.transactionHash).toLowerCase(),
        created_at: new Date(Number(ev.blockTimestamp) * 1000),
        updated_at: new Date(),
        status: "confirmed",
        source: "indexer",
      },
      {
        onConflict: "listing_id",
        ignoreDuplicates: false,
      },
    )

    await insertActivity({
      event: "LISTING_CREATED",
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId?.toString(),
      from: String(seller),
      price: price?.toString(),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  ListingUpdated: async (ev, args, source) => {
    const { collection, tokenId, newPrice } = args

    await supabase
      .from("listings")
      .update({
        price: Number(newPrice),
        updated_at: new Date(Number(ev.blockTimestamp) * 1000),
      })
      .eq("listing_id", `${collection.toLowerCase()}-${tokenId}`)
      .eq("is_active", true)

    await insertActivity({
      event: "LISTING_UPDATED",
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId?.toString(),
      price: newPrice?.toString(),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  ListingCancelled: async (ev, args, source) => {
    const { collection, tokenId, seller } = args

    await supabase
      .from("listings")
      .update({
        is_active: false,
        updated_at: new Date(Number(ev.blockTimestamp) * 1000),
      })
      .eq("listing_id", `${collection.toLowerCase()}-${tokenId}`)

    await insertActivity({
      event: "LISTING_CANCELLED",
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId?.toString(),
      from: String(seller),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  Sale: async (ev, args, source) => {
    const { collection, tokenId, seller, buyer, price, marketplaceFeeAmount, royaltyAmount } = args

    // Update listing
    await supabase
      .from("listings")
      .update({
        is_active: false,
        buyer_wallet: String(buyer).toLowerCase(),
        updated_at: new Date(Number(ev.blockTimestamp) * 1000),
      })
      .eq("listing_id", `${collection.toLowerCase()}-${tokenId}`)

    // Update NFT owner
    await upsertNFT(String(collection).toLowerCase(), tokenId?.toString(), String(buyer), Number(ev.blockTimestamp))

    // Insert activity
    await insertActivity({
      event: "SALE",
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId?.toString(),
      from: String(seller),
      to: String(buyer),
      price: price?.toString(),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })

    // Update collection stats
    await supabase.rpc("increment_collection_stats", {
      p_collection_address: String(collection).toLowerCase(),
      p_volume: Number(price) / 1e18,
      p_sales: 1,
    })
  },

  MarketplaceFeeUpdated: async (ev, args, source) => {
    const { oldFee, newFee } = args

    await insertActivity({
      event: "MARKETPLACE_FEE_UPDATED",
      collectionAddress: CORE_CONTRACT_ADDRESS.toLowerCase(),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  FeeReceiverUpdated: async (ev, args, source) => {
    const { oldReceiver, newReceiver } = args

    await insertActivity({
      event: "FEE_RECEIVER_UPDATED",
      collectionAddress: CORE_CONTRACT_ADDRESS.toLowerCase(),
      from: String(oldReceiver),
      to: String(newReceiver),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  // Eventos administrativos del Core
  OwnershipTransferred: async (ev, args, source) => {
    const { previousOwner, newOwner } = args

    await insertActivity({
      event: "OWNERSHIP_TRANSFERRED",
      collectionAddress: CORE_CONTRACT_ADDRESS.toLowerCase(),
      from: String(previousOwner).toLowerCase(),
      to: String(newOwner).toLowerCase(),
      txHash: String(ev.transactionHash).toLowerCase(),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  ContractAuthorized: async (ev, args, source) => {
    const { contractAddr, authorized } = args

    await insertActivity({
      event: "CONTRACT_AUTHORIZED",
      collectionAddress: CORE_CONTRACT_ADDRESS.toLowerCase(),
      to: String(contractAddr).toLowerCase(),
      price: authorized ? "true" : "false",
      txHash: String(ev.transactionHash).toLowerCase(),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  Paused: async (ev, args, source) => {
    await insertActivity({
      event: "PAUSED",
      collectionAddress: source === "core" ? CORE_CONTRACT_ADDRESS.toLowerCase() : BIDS_CONTRACT_ADDRESS.toLowerCase(),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  Unpaused: async (ev, args, source) => {
    await insertActivity({
      event: "UNPAUSED",
      collectionAddress: source === "core" ? CORE_CONTRACT_ADDRESS.toLowerCase() : BIDS_CONTRACT_ADDRESS.toLowerCase(),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  // ───── BIDS EVENTS ─────
  CollectionBidPlaced: async (ev, args, source) => {
    const { collection, bidder, pricePerItem, quantity, expiresAt } = args

    // Cancel previous bid if exists
    await supabase
      .from("collection_bids")
      .update({ is_active: false })
      .eq("collection_address", String(collection).toLowerCase())
      .eq("bidder_wallet", String(bidder).toLowerCase())
      .eq("is_active", true)

    // Insert new bid
    await supabase.from("collection_bids").insert({
      collection_address: String(collection).toLowerCase(),
      bidder_wallet: String(bidder).toLowerCase(),
      price: Number(pricePerItem),
      quantity: Number(quantity),
      expires_at: expiresAt && Number(expiresAt) > 0 ? new Date(Number(expiresAt)) : null,
      is_active: true,
      created_at: new Date(Number(ev.blockTimestamp) * 1000),
    })

    await insertActivity({
      event: "COLLECTION_BID_PLACED",
      collectionAddress: String(collection),
      to: String(bidder),
      price: pricePerItem?.toString(),
      quantity: Number(quantity),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  CollectionBidAccepted: async (ev, args, source) => {
    const { collection, bidder, seller, tokenIds, totalPrice } = args

    // Deactivate or update bid
    const { data: existingBid } = await supabase
      .from("collection_bids")
      .select("quantity")
      .eq("collection_address", String(collection).toLowerCase())
      .eq("bidder_wallet", String(bidder).toLowerCase())
      .eq("is_active", true)
      .single()

    if (existingBid) {
      const remainingQuantity = existingBid.quantity - tokenIds.length

      if (remainingQuantity <= 0) {
        await supabase
          .from("collection_bids")
          .update({
            is_active: false,
            updated_at: new Date(Number(ev.blockTimestamp) * 1000),
          })
          .eq("collection_address", String(collection).toLowerCase())
          .eq("bidder_wallet", String(bidder).toLowerCase())
      } else {
        await supabase
          .from("collection_bids")
          .update({
            quantity: remainingQuantity,
            updated_at: new Date(Number(ev.blockTimestamp) * 1000),
          })
          .eq("collection_address", String(collection).toLowerCase())
          .eq("bidder_wallet", String(bidder).toLowerCase())
      }
    }

    // Update NFT owners
    for (const tokenId of tokenIds) {
      await upsertNFT(String(collection).toLowerCase(), tokenId.toString(), String(bidder).toLowerCase(), Number(ev.blockTimestamp))

      // Cancel listing if exists
      await supabase.from("listings").update({ is_active: false }).eq("listing_id", `${collection.toLowerCase()}-${tokenId}`)
    }

    await insertActivity({
      event: "COLLECTION_BID_ACCEPTED",
      collectionAddress: String(collection).toLowerCase(),
      from: String(seller).toLowerCase(),
      to: String(bidder).toLowerCase(),
      price: totalPrice?.toString(),
      quantity: tokenIds.length,
      txHash: String(ev.transactionHash).toLowerCase(),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })

    // Update collection stats
    await supabase.rpc("increment_collection_stats", {
      p_collection_address: String(collection).toLowerCase(),
      p_volume: Number(totalPrice) / 1e18,
      p_sales: tokenIds.length,
    })
  },

  CollectionBidCancelled: async (ev, args, source) => {
    const { collection, bidder } = args

    await supabase
      .from("collection_bids")
      .update({
        is_active: false,
        updated_at: new Date(Number(ev.blockTimestamp) * 1000),
      })
      .eq("collection_address", String(collection).toLowerCase())
      .eq("bidder_wallet", String(bidder).toLowerCase())

    await insertActivity({
      event: "COLLECTION_BID_CANCELLED",
      collectionAddress: String(collection),
      to: String(bidder),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  TokenBidPlaced: async (ev, args, source) => {
    const { collection, tokenId, bidder, price, expiresAt } = args

    // Cancel previous bid if exists
    await supabase
      .from("token_bids")
      .update({ is_active: false })
      .eq("collection_address", String(collection).toLowerCase())
      .eq("token_id", tokenId?.toString())
      .eq("bidder_wallet", String(bidder).toLowerCase())
      .eq("is_active", true)

    // Insert new bid
    const { data, error } = await supabase.from("token_bids").insert({
      collection_address: String(collection).toLowerCase(),
      token_id: tokenId?.toString(),
      bidder_wallet: String(bidder).toLowerCase(),
      price: Number(price),
      expires_at: expiresAt && Number(expiresAt) > 0 ? new Date(Number(expiresAt)) : null,
      is_active: true,
      created_at: new Date(Number(ev.blockTimestamp) * 1000),
    })

    if (error) {
      console.error("❌ ERROR INSERT token_bids:", error)
    } else {
      console.log("✅ INSERT OK token_bids:", data)
    }

    await insertActivity({
      event: "TOKEN_BID_PLACED",
      collectionAddress: String(collection),
      tokenId: tokenId?.toString(),
      to: String(bidder),
      price: price?.toString(),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },

  TokenBidAccepted: async (ev, args, source) => {
    const { collection, tokenId, bidder, seller, price } = args

    // Deactivate bid
    await supabase
      .from("token_bids")
      .update({
        is_active: false,
        updated_at: new Date(Number(ev.blockTimestamp) * 1000),
      })
      .eq("collection_address", String(collection).toLowerCase())
      .eq("token_id", tokenId?.toString())
      .eq("bidder_wallet", String(bidder).toLowerCase())

    // Cancel listing if exists
    await supabase.from("listings").update({ is_active: false }).eq("listing_id", `${collection.toLowerCase()}-${tokenId}`)

    // Update NFT owner
    await upsertNFT(String(collection).toLowerCase(), tokenId?.toString(), String(bidder).toLowerCase(), Number(ev.blockTimestamp))

    await insertActivity({
      event: "TOKEN_BID_ACCEPTED",
      collectionAddress: String(collection).toLowerCase(),
      tokenId: tokenId?.toString(),
      from: String(seller).toLowerCase(),
      to: String(bidder).toLowerCase(),
      price: price?.toString(),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })

    // Update collection stats
    await supabase.rpc("increment_collection_stats", {
      p_collection_address: String(collection).toLowerCase(),
      p_volume: Number(price) / 1e18,
      p_sales: 1,
    })
  },

  TokenBidCancelled: async (ev, args, source) => {
    const { collection, tokenId, bidder } = args

    await supabase
      .from("token_bids")
      .update({
        is_active: false,
        updated_at: new Date(Number(ev.blockTimestamp) * 1000),
      })
      .eq("collection_address", String(collection).toLowerCase())
      .eq("token_id", tokenId?.toString())
      .eq("bidder_wallet", String(bidder).toLowerCase())

    await insertActivity({
      event: "TOKEN_BID_CANCELLED",
      collectionAddress: String(collection),
      tokenId: tokenId?.toString(),
      to: String(bidder),
      txHash: String(ev.transactionHash),
      createdAt: new Date(Number(ev.blockTimestamp) * 1000),
      logIndex: ev.logIndex,
      sourceContract: source,
    })
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN INDEXER LOOP
// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  if (running) return
  running = true
  console.log(`[RUN #${runs}] Starting indexer for Core & Bids contracts...`)

  try {
    // Get indexer state
    const { data: state, error: stateError } = await supabase.from("indexer_state").select("last_block").eq("chain_id", CHAIN_IDS.SEPOLIA).single()

    if (stateError) {
      console.error("State error:", stateError)
      return
    }

    // Get registered collections
    const { data: collections = [] } = await supabase.from("collections").select("*")

    const fromBlock = BigInt(state.last_block + 1)
    let toBlock = await client.getBlockNumber()

    if (fromBlock > toBlock) {
      console.log("Already synced")
      return
    }

    // Limit batch size
    if (toBlock > fromBlock + BigInt(5000)) {
      toBlock = fromBlock + BigInt(5000)
    }

    console.log(`Indexing blocks ${fromBlock} → ${toBlock}`)

    let allEvents: any[] = []

    // ───── INDEXAR EVENTOS DE CORE Y BIDS ─────
    for (const contract of CONTRACTS_TO_INDEX) {
      console.log(`  📝 Fetching events from ${contract.name}...`)

      try {
        const events = await client.getContractEvents({
          address: contract.address,
          abi: contract.abi,
          fromBlock,
          toBlock,
        })

        // Marcar cada evento con el nombre del contrato
        const eventsWithSource = events.map((ev) => ({
          ...ev,
          contractName: contract.name,
          contractAddress: contract.address,
        }))

        allEvents.push(...eventsWithSource)
        console.log(`    ✅ Found ${events.length} events`)
      } catch (err) {
        console.error(`    ❌ Error fetching events from ${contract.name}:`, err)
      }
    }

    // Sort by block and logIndex
    allEvents.sort((a, b) => Number(a.blockNumber - b.blockNumber) || Number(a.logIndex - b.logIndex))

    console.log(`Total events across all contracts: ${allEvents.length}`)

    // Procesar todos los eventos
    for (const ev of allEvents) {
      try {
        let decoded: any

        // Determinar qué ABI usar basado en el contrato
        const contractConfig = CONTRACTS_TO_INDEX.find((c) => c.address.toLowerCase() === String(ev.address).toLowerCase())

        if (!contractConfig) {
          console.warn(`Unknown contract: ${ev.address}`)
          continue
        }

        decoded = decodeEventLog({
          abi: contractConfig.abi,
          data: ev.data,
          topics: ev.topics,
        })

        if (!decoded) continue

        const { eventName, args } = decoded
        console.log(`  [${contractConfig.name}:${eventName}] block=${ev.blockNumber}`)

        const handler = eventHandlers[eventName]
        if (handler) {
          await handler(ev, args, contractConfig.name)
        } else {
          console.warn(`  ⚠️  No handler for event: ${eventName}`)
        }
      } catch (err) {
        console.error("Event processing error:", ev, err)
      }
    }

    // ───── NFT TRANSFER EVENTS (opcional, si los necesitas) ─────
    for (const col of collections as any[]) {
      try {
        let _fromBlock = col.indexer_block
        const _lastBlock = await client.getBlockNumber()
        let _toBlock = _lastBlock > _fromBlock + 50000 ? _fromBlock + 50000 : _lastBlock

        while (_fromBlock <= _lastBlock) {
          console.log(`  [${col.contract_address}] Transfers ${_fromBlock} → ${_toBlock}`)

          const colEvents = await client.getContractEvents({
            address: col.contract_address as Address,
            abi: erc721Abi,
            eventName: "Transfer",
            fromBlock: BigInt(_fromBlock),
            toBlock: BigInt(_toBlock),
          })

          for (const ev of colEvents) {
            try {
              const decoded = decodeEventLog({
                abi: erc721Abi,
                data: ev.data,
                topics: ev.topics as any,
              }) as any

              if (!decoded) continue

              const { from, to, tokenId } = decoded.args

              // Update NFT
              await upsertNFT(col.contract_address, tokenId?.toString(), String(to), Number(ev.blockTimestamp))

              // Insert transfer activity
              await insertActivity({
                event: "TRANSFER",
                collectionAddress: col.contract_address.toLowerCase(),
                tokenId: tokenId?.toString(),
                from: String(from).toLowerCase(),
                to: String(to).toLowerCase(),
                txHash: String(ev.transactionHash).toLowerCase(),
                createdAt: new Date(Number(ev.blockTimestamp) * 1000),
                logIndex: ev.logIndex,
                sourceContract: "nft_transfer",
              })
            } catch (err) {
              console.error("Transfer event error:", err)
            }
          }

          // Update collection indexer state
          await supabase
            .from("collections")
            .update({ indexer_block: Number(_toBlock) })
            .eq("contract_address", col.contract_address.toLowerCase())

          _fromBlock += 50000
          _toBlock = _lastBlock > _fromBlock + 50000 ? _fromBlock + 50000 : _lastBlock
        }
      } catch (err) {
        console.error(`Error indexing collection ${col.contract_address}:`, err)
      }
    }

    // Update global indexer state
    await supabase
      .from("indexer_state")
      .update({ last_block: Number(toBlock) })
      .eq("chain_id", CHAIN_IDS.SEPOLIA)

    console.log(`✅ Indexed up to block ${toBlock} (Core & Bids contracts)`)
  } catch (err) {
    console.error("❌ Indexer error:", err)
  } finally {
    running = false
    runs += 1
  }
}

export { run }
