// lib/chains.ts
// Single source for the chain the app runs on + its explorer base URL.
// Bump these together when the app moves off Sepolia.
export const CHAIN_ID = 11155111 // Sepolia

export const EXPLORER_URL = "https://sepolia.etherscan.io"

export const explorerTxUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`
export const explorerAddressUrl = (address: string) => `${EXPLORER_URL}/address/${address}`
export const explorerTokenUrl = (address: string) => `${EXPLORER_URL}/token/${address}`
export const explorerTokenInstanceUrl = (address: string, tokenId: string) => `${EXPLORER_URL}/token/${address}?a=${tokenId}`
