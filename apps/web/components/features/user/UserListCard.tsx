"use client"

import { useState, useEffect, useMemo } from "react"
import { Address, erc721Abi, parseEther } from "viem"
import { useConnection, useWriteContract, useReadContracts, usePublicClient } from "wagmi"
import { FaEthereum, FaTrash } from "react-icons/fa"
import { MdOutlineLocalOffer } from "react-icons/md"
import { RiNftFill } from "react-icons/ri"
import { MARKETPLACE_CONTRACT_ADDRESS } from "@/lib/constants"
import { CHAIN_ID } from "@/lib/chains"
import { MarketplaceABI } from "@/lib/abi"
import { EnrichedUserNFT, UserListing, Collection, UserNFT } from "@/types/user.types"
import { BatchType } from "@/hooks/useBatchOperations"
import { useMarketplaceInfo } from "@/hooks/useMarketplaceReads"
import { useTx } from "@/app/context/TxContext"
import { saveBatchListingToDB } from "@/actions/listings/createBatch"
import { failListingsByTxHash } from "@/actions/listings/failBatch"
import ExpirationPicker from "@/components/ui/ExpirationPicker"
import { Modal } from "@/components/ui/Modal"
import { dateToEpochSeconds } from "@/lib/dates"
import { useAuth } from "@/components/AuthProvider"

export interface ListableItem {
  collection_address: Address
  token_id: string
  price?: bigint
}

interface UserListCardProps {
  items: EnrichedUserNFT[]
  collections: Collection[]
  listings: UserListing[]
  onClose: () => void
  onSuccess?: () => void
  /** Called right after the tx is sent — optimistic local patch (instant UX). */
  onOptimisticList?: (items: ListableItem[]) => void
  /** Called when the tx fails — revert the optimistic patch. */
  onOptimisticListFail?: (items: ListableItem[]) => void
  removeFromBatch: (token: UserNFT, batch: BatchType) => void
}

interface ListItemWithPrice extends EnrichedUserNFT {
  priceEth?: string
}

export function UserListCard({ items, collections, listings, onClose, onSuccess, onOptimisticList, onOptimisticListFail, removeFromBatch }: UserListCardProps) {
  const [priceAll, setPriceAll] = useState<string>("")
  const [totalEstimated, setTotalEstimated] = useState<number>(0)
  const [totalRoyalties, setTotalRoyalties] = useState<number>(0)
  const [totalMarketplaceFee, setTotalMarketplaceFee] = useState<number>(0)
  const [listItems, setListItems] = useState<any[]>(items)
  const { addTx, removeTx, updateTx } = useTx()
  const info = useMarketplaceInfo()
  const { address } = useConnection()
  const { session } = useAuth()
  const token = session?.access_token

  useEffect(() => {
    setListItems(items)
  }, [items])

  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const { data: names } = useReadContracts({
    contracts: collections.map((col) => ({
      address: col.contract_address,
      abi: erc721Abi,
      functionName: "name",
    })),
    query: {
      enabled: Boolean(collections.length),
    },
  })

  const { data: colsData, isLoading: isLoadingCore } = useReadContracts({
    contracts: collections.map((col) => ({
      address: MARKETPLACE_CONTRACT_ADDRESS as Address,
      abi: MarketplaceABI,
      functionName: "collections",
      args: [col.contract_address as Address],
    })),
    query: {
      enabled: Boolean(collections.length),
    },
  })

  const floors = useMemo<Record<string, bigint>>(() => {
    if (!listings?.length) return {}

    const map: Record<string, bigint> = {}

    for (const listing of listings) {
      const col = listing.collection_address.toLowerCase()
      const price = BigInt(listing.price)

      if (!map[col] || price < map[col]) {
        map[col] = price
      }
    }

    return map
  }, [listings])

  useEffect(() => {
    if (!colsData || !info) return

    let _marketplaceFee = 0
    let _royaltyFee = 0
    let _totalEstimated = 0

    listItems.forEach((item) => {
      if (!item.price || item.price === BigInt(0)) return

      const colIndex = collections.findIndex((col) => col.contract_address.toLowerCase() === item.collection_address.toLowerCase())

      if (colIndex === -1 || !colsData[colIndex]) return

      const colData = colsData[colIndex].result as any
      const priceNum = Number(item.price)

      const royaltyFee = (priceNum * Number(colData.royaltyFee)) / 10000
      const marketplaceFee = (priceNum * Number(info.marketplaceFee)) / 10000
      const netAmount = priceNum - royaltyFee - marketplaceFee

      _marketplaceFee += marketplaceFee
      _royaltyFee += royaltyFee
      _totalEstimated += netAmount
    })

    setTotalEstimated(_totalEstimated)
    setTotalMarketplaceFee(_marketplaceFee)
    setTotalRoyalties(_royaltyFee)
  }, [colsData, listItems, info, collections])

  const handleList = async () => {
    const validItems = listItems.filter((i) => i.price && i.price > BigInt(0))
    if (!validItems.length) return

    let txHash: `0x${string}` | undefined
    try {
      const collections = validItems.map((i) => i.collection_address as Address)
      const tokenIds = validItems.map((i) => i.token_id.toString())
      const prices = validItems.map((i) => i.price!.toString())
      const expiresAts = validItems.map((i) => dateToEpochSeconds(i.expiresAt).toString())
      const seller = address!.toLowerCase() as Address
      const chainId = CHAIN_ID

      txHash = await writeContractAsync({
        address: MARKETPLACE_CONTRACT_ADDRESS,
        abi: MarketplaceABI,
        functionName: "createListingBatch",
        args: [collections, tokenIds.map(BigInt), prices.map(BigInt), expiresAts.map(BigInt)],
      })
      const hash = txHash

      // Optimistic local patch: the listed items render as listed immediately,
      // before the server-action insert / realtime round-trip.
      onOptimisticList?.(validItems)

      addTx({
        hash,
        status: "loading",
        label: `Listing ${validItems.length} items...`,
      })

      await saveBatchListingToDB({
        txHash: hash,
        collections,
        tokenIds,
        prices,
        seller,
        chainId,
        expiresAts,
      })

      await publicClient!.waitForTransactionReceipt({ hash })
      updateTx(hash, { status: "success", label: "Listed!" })

      setTimeout(() => removeTx(hash), 3000)

      onSuccess?.()
    } catch (err) {
      console.error("Listing error:", err)
      const hash = txHash ?? (err as any)?.hash
      if (hash) {
        updateTx(hash, { status: "error", label: "Listing failed" })
        setTimeout(() => removeTx(hash), 5000)
      }

      // Revert the optimistic patch and kill any stale `pending` DB rows so a
      // reverted listing doesn't linger forever.
      onOptimisticListFail?.(validItems)
      if (hash) {
        failListingsByTxHash(hash).catch((e) => console.error("Failed to fail listings:", e))
      }
    }
  }

  const updateItemExpirationDate = (tokenId: string, collection: string, expiresAt: Date) => {
    setListItems((prev) => prev.map((item) => (item.token_id === tokenId && item.collection_address.toLowerCase() === collection.toLowerCase() ? { ...item, expiresAt: expiresAt } : item)))
  }

  const updateItemPrice = (tokenId: string, collection: string, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return

    const wei = value === "" ? BigInt(0) : parseEther(value)

    setListItems((prev) => prev.map((item) => (item.token_id === tokenId && item.collection_address.toLowerCase() === collection.toLowerCase() ? { ...item, priceEth: value, price: wei } : item)))
  }

  const updateAllPrices = (value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return

    const wei = value === "" ? BigInt(0) : parseEther(value)

    setPriceAll(value)

    setListItems((prev) =>
      prev.map((item) => ({
        ...item,
        priceEth: value,
        price: wei,
      })),
    )
  }

  const removeListItem = (tokenId: string, collection: Address) => {
    removeFromBatch({ token_id: tokenId, collection_address: collection } as UserNFT, "list")
  }

  const getCollectionName = (collectionAddress: string): string => {
    const colIndex = collections.findIndex((col) => col.contract_address.toLowerCase() === collectionAddress.toLowerCase())

    if (colIndex === -1 || !names?.[colIndex]) return "Unknown"

    return String(names[colIndex].result) || "Unknown"
  }

  const getCollectionData = (collectionAddress: string): any => {
    const colIndex = collections.findIndex((col) => col.contract_address.toLowerCase() === collectionAddress.toLowerCase())

    if (colIndex === -1 || !colsData?.[colIndex]) return null

    return colsData[colIndex].result
  }

  const canList = listItems.some((item) => item.price && item.price > BigInt(0))

  return (
    <Modal
      id="list-card"
      onClose={onClose}
      title="List items"
      icon={<MdOutlineLocalOffer className="text-3xl" />}
      panelClassName="min-w-[80%] max-h-[75vh]"
      backdropClassName="fixed bg-black/50 justify-center items-center flex backdrop-blur-sm pt-10 h-full w-full left-0 top-0 z-50"
    >
        {/* Table header */}
        <div className="flex w-full justify-between px-6 font-bold  py-3">
          <div className="flex flex-2 gap-2 items-center">
            <span>{listItems.length} items</span>
          </div>
          <div className="flex flex-1 gap-2 items-center">
            <span>Floor</span>
          </div>
          <div className="flex flex-1 gap-2 items-center">
            <span>Royalty</span>
          </div>
          <div className="flex flex-1 gap-2 items-center">
            <span>Price</span>
          </div>
          <div className="flex flex-1 gap-2 items-center">
            <span>Expires At</span>
          </div>
          <div className="flex flex-[0.2] gap-2 items-center" />
        </div>

        {/* Items list - scrollable */}
        <div className="flex flex-col w-full overflow-y-auto max-h-[50vh]">
          {listItems.map((item, index) => {
            const floor = floors[item.collection_address.toLowerCase()]
            const collectionName = getCollectionName(item.collection_address)
            const colData = getCollectionData(item.collection_address)
            const royaltyPercent = colData ? Number(colData.royaltyFee) / 100 : 0
            const royaltyAmount = item.priceEth ? (Number(item.priceEth) * royaltyPercent) / 100 : 0

            return (
              <div className="flex items-center px-6 justify-between w-full py-6 " key={`${item.collection_address}-${item.token_id}`}>
                {/* NFT Info */}
                <div className="flex flex-2 items-center gap-3">
                  <RiNftFill className="text-xl opacity-75" />
                  <div className="flex flex-col items-start">
                    <span className="font-bold">#{item.token_id}</span>
                    <span className="text-sm opacity-65">{collectionName}</span>
                  </div>
                </div>

                {/* Floor */}
                <div className="flex gap-2 items-center flex-1">
                  <div className="flex gap-1 items-center">
                    <span>{floor ? (Number(floor) / 1e18).toFixed(4) : "-"}</span>
                    {floor && <FaEthereum className="text-sm" />}
                  </div>
                </div>

                {/* Royalty */}
                <div className="flex-1 flex items-center gap-2">
                  <span className="flex items-center gap-1">
                    {royaltyAmount ? royaltyAmount.toFixed(4) : "-"}
                    {royaltyAmount > 0 && <FaEthereum className="text-sm" />}
                  </span>
                  <span className="text-sm opacity-65">({royaltyPercent ? `${royaltyPercent}%` : "-%"})</span>
                </div>

                {/* Price input */}
                <div className="flex flex-1">
                  <div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.priceEth ?? ""}
                      onChange={(e) => updateItemPrice(item.token_id, item.collection_address, e.target.value)}
                      className="rounded flex-1 p-3 text-sm w-[80%]"
                      placeholder="0.00 ETH"
                    />
                  </div>
                </div>

                {/* Expiration date input */}

                <div className="flex flex-1">
                  <ExpirationPicker onChange={(date: Date) => updateItemExpirationDate(item.token_id, item.collection_address, date)} />
                </div>

                {/* Remove button */}
                <div className="flex flex-[0.2] justify-center gap-2 items-center">
                  <button onClick={() => removeListItem(item.token_id, item.collection_address)} className="p-2 bg-transparent! text-(--text)! hover:opacity-75">
                    <FaTrash className="opacity-75" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer - Summary and List button */}
        <div className="w-full flex flex-col border-t border-(--text)/20 p-4 bg-(--bg)/50">
          <div className="flex justify-between items-center">
            <div className="flex flex-col gap-2">
              {/* Total estimated */}
              <div className="flex items-center gap-4">
                <span className="font-bold text-xl">Total estimated:</span>
                <div className="flex gap-2 items-center text-xl">
                  <span>{totalEstimated ? (totalEstimated / 1e18).toFixed(4) : "0.00"}</span>
                  <FaEthereum />
                </div>
              </div>

              {/* Fees breakdown */}
              <div className="flex items-center gap-4 text-sm opacity-75">
                {/* Royalties */}
                <div className="flex items-center gap-2">
                  <span className="font-bold">Royalties:</span>
                  <div className="flex gap-2 items-center">
                    <span>{totalRoyalties ? (totalRoyalties / 1e18).toFixed(4) : "0.00"}</span>
                    <span>
                      ({totalRoyalties ? ((totalRoyalties / (totalEstimated + totalMarketplaceFee + totalRoyalties)) * 100).toFixed(2) : "0"}
                      %)
                    </span>
                  </div>
                </div>

                {/* Marketplace fee */}
                <div className="flex items-center gap-2">
                  <span className="font-bold">Marketplace:</span>
                  <div className="flex gap-2 items-center">
                    <span>{totalMarketplaceFee ? (totalMarketplaceFee / 1e18).toFixed(4) : "0.00"}</span>
                    <span>
                      ({totalMarketplaceFee ? ((totalMarketplaceFee / (totalEstimated + totalMarketplaceFee + totalRoyalties)) * 100).toFixed(2) : "0"}
                      %)
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex  gap-4 items-center justify-end">
              {/* Set all price */}
              <div className=" flex ">
                <div className="flex gap-2 items-center">
                  <span className="text-sm">Set all to:</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priceAll}
                    onChange={(e) => updateAllPrices(e.target.value)}
                    className="text-sm rounded w-32 p-2 border border-(--text)/20"
                    placeholder="0.00 ETH"
                  />
                </div>
              </div>

              {/* List button */}
              <button
                onClick={handleList}
                disabled={!canList}
                className={`
                  px-8 py-3 rounded flex gap-2 items-center font-bold
                  ${canList ? "bg-(--accent) text-(--bg-secondary) hover:opacity-90" : "bg-(--accent)/30 text-(--text)/50 cursor-not-allowed"}
                `}
              >
                <span>List</span>
                <span>{listItems.length}</span>
                <span>items</span>
              </button>
            </div>
          </div>
        </div>
    </Modal>
  )
}
