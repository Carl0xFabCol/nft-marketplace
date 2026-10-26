"use client"

import { useState } from "react"
import { getGatewayCount, getGatewayForIpfsPath, getIpfsPath, reportGatewayFailure, reportGatewaySuccess, resolveIpfsUrl } from "@/lib/resolveIPFS"

function initialState(src: string | null | undefined): { gatewayIndex: number | null; failed: boolean } {
  if (!src) return { gatewayIndex: null, failed: true }

  const ipfsPath = getIpfsPath(src)
  if (!ipfsPath) return { gatewayIndex: 0, failed: false }

  const gateway = getGatewayForIpfsPath(ipfsPath)
  return { gatewayIndex: gateway, failed: gateway === null }
}

interface IpfsImageProps {
  src: string | null | undefined
  alt?: string
  className?: string
}

export function IpfsImage({ src, alt = "NFT", className = "" }: IpfsImageProps) {
  const [gatewayIndex, setGatewayIndex] = useState<number | null>(() => initialState(src).gatewayIndex)
  const [failed, setFailed] = useState(() => initialState(src).failed)
  const [prevSrc, setPrevSrc] = useState(src)

  if (src !== prevSrc) {
    const next = initialState(src)
    setPrevSrc(src)
    setGatewayIndex(next.gatewayIndex)
    setFailed(next.failed)
  }

  if (!src || failed || gatewayIndex === null) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-sm opacity-50">No image</span>
      </div>
    )
  }

  const imageUrl = resolveIpfsUrl(src, gatewayIndex)

  if (!imageUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-sm opacity-50">No image</span>
      </div>
    )
  }

  const ipfsPath = getIpfsPath(src)

  return (
    // IPFS gateways are dynamic and not known at build time, so next/image
    // cannot optimize them; this <img> is the gateway-failover implementation.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={() => {
        if (ipfsPath) {
          reportGatewaySuccess(ipfsPath, gatewayIndex)
        }
      }}
      onError={() => {
        reportGatewayFailure(gatewayIndex)

        if (!ipfsPath) {
          setFailed(true)
          return
        }

        const nextGateway = getGatewayForIpfsPath(ipfsPath)

        if (nextGateway !== null && nextGateway !== gatewayIndex) {
          setGatewayIndex(nextGateway)
          return
        }

        for (let i = 0; i < getGatewayCount(); i++) {
          if (i !== gatewayIndex) {
            setGatewayIndex(i)
            return
          }
        }

        setFailed(true)
      }}
    />
  )
}
