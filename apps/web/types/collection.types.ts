export interface Collection {
  contract_address: `0x${string}`
  name: string | null
  symbol: string | null
  image_url: string | null
  verified: boolean
  total_volume?: number
  total_sales?: number
}
