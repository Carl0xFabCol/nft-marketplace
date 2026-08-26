const IPFS_GATEWAYS = [process.env.NEXT_PUBLIC_PINATA_GATEWAY, "https://gateway.pinata.cloud/ipfs", "https://dweb.link/ipfs"].filter(Boolean)

const PINATA_GATEWAY_KEY = process.env.NEXT_PUBLIC_PINATA_GATEWAY_KEY

const GATEWAY_COOLDOWN_MS = 60_000

type GatewayState = {
  unhealthyUntil: number
}

const gatewayStates = new Map<number, GatewayState>()

const cidGatewayCache = new Map<string, number>()

let preferredGateway = 0

export function getIpfsPath(url: string): string | null {
  if (!url) return null

  if (url.startsWith("ipfs://")) {
    return url.replace("ipfs://", "")
  }

  const match = url.match(/\/ipfs\/(.+)/)

  return match?.[1] ?? null
}

export function getIpfsCid(url: string): string | null {
  const path = getIpfsPath(url)

  if (!path) return null

  return path.split("/")[0]
}

function isGatewayHealthy(index: number): boolean {
  const state = gatewayStates.get(index)

  if (!state) return true

  if (Date.now() >= state.unhealthyUntil) {
    gatewayStates.delete(index)
    return true
  }

  return false
}

export function getGatewayForIpfsPath(ipfsPath: string): number | null {
  const cachedGateway = cidGatewayCache.get(ipfsPath)

  if (cachedGateway !== undefined && isGatewayHealthy(cachedGateway)) {
    return cachedGateway
  }

  if (isGatewayHealthy(preferredGateway)) {
    return preferredGateway
  }

  for (let i = 0; i < IPFS_GATEWAYS.length; i++) {
    if (isGatewayHealthy(i)) {
      return i
    }
  }

  return null
}

export function resolveIpfsUrl(url: string, gatewayIndex = 0): string | null {
  const ipfsPath = getIpfsPath(url)

  if (!ipfsPath) {
    return url
  }

  const gateway = IPFS_GATEWAYS[gatewayIndex]

  if (!gateway) {
    return null
  }

  const baseUrl = `${gateway}/${ipfsPath}`

  if (gatewayIndex === 0 && PINATA_GATEWAY_KEY) {
    return `${baseUrl}?pinataGatewayToken=${encodeURIComponent(PINATA_GATEWAY_KEY)}`
  }

  return baseUrl
}

export function reportGatewaySuccess(ipfsPath: string, gatewayIndex: number) {
  cidGatewayCache.set(ipfsPath, gatewayIndex)

  preferredGateway = gatewayIndex

  gatewayStates.delete(gatewayIndex)
}

export function reportGatewayFailure(gatewayIndex: number) {
  gatewayStates.set(gatewayIndex, {
    unhealthyUntil: Date.now() + GATEWAY_COOLDOWN_MS,
  })

  if (preferredGateway === gatewayIndex) {
    for (let i = 0; i < IPFS_GATEWAYS.length; i++) {
      if (i !== gatewayIndex && isGatewayHealthy(i)) {
        preferredGateway = i
        return
      }
    }
  }
}

export function getGatewayCount(): number {
  return IPFS_GATEWAYS.length
}
