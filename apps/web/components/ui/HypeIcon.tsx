import Image from "next/image"

/**
 * HYPE currency glyph. The deployment chain is Elysium, whose native gas token
 * is HYPE — the Ethereum diamond must not be used anywhere in the UI.
 */
export function HypeIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/Hyperliquid_Blob_Green.svg"
      alt="HYPE"
      width={16}
      height={16}
      unoptimized
      className={className}
      style={{ width: "1em", height: "1em" }}
    />
  )
}
