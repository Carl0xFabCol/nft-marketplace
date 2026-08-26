"use client"

import { useEffect, useState } from "react"
import { getGatewayCount, getGatewayForIpfsPath, getIpfsPath, reportGatewayFailure, reportGatewaySuccess, resolveIpfsUrl } from "@/lib/resolveIPFS"

interface IpfsImageProps {
  src: string | null | undefined
  alt?: string
  className?: string
}

export function IpfsImage({ src, alt = "NFT", className = "" }: IpfsImageProps) {
  const [gatewayIndex, setGatewayIndex] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!src) {
      setGatewayIndex(null)
      setFailed(true)
      return
    }

    const ipfsPath = getIpfsPath(src)

    if (!ipfsPath) {
      setGatewayIndex(0)
      setFailed(false)
      return
    }

    const gateway = getGatewayForIpfsPath(ipfsPath)

    setGatewayIndex(gateway)
    setFailed(gateway === null)
  }, [src])

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
    <img
      src={imageUrl}
      alt={alt}
      className={className}
      onLoad={() => {
        if (ipfsPath) {
          reportGatewaySuccess(ipfsPath, gatewayIndex)
        }

        console.log(`IPFS IMAGE LOADED [gateway ${gatewayIndex}]`, imageUrl)
      }}
      onError={() => {
        console.warn(`IPFS IMAGE FAILED [gateway ${gatewayIndex}]`, imageUrl)

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
