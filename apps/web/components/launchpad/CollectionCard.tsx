import Image from "next/image"
import { Collection } from "@/types/user.types"
import { MintForm } from "@/components/MintForm"
import { BadgeCheck } from "lucide-react"

interface Props {
  collection: Collection
}

export function CollectionCard({ collection }: Props) {
  const { contract_address, name, symbol, image_url, is_verified } = collection

  return (
    <article className="group rounded-xl border border-(--accent)/20 bg-(--accent)/5 overflow-hidden flex flex-col transition hover:border-(--accent)/50 hover:bg-(--accent)/10">
      {/* Image */}
      <div className="relative aspect-square w-full overflow-hidden bg-(--accent)/10">
        {image_url ? (
          <Image
            src={image_url}
            alt={name ?? "Collection"}
            fill
            unoptimized
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-(--muted) text-sm">No image found</div>
        )}
        {is_verified && (
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/70 backdrop-blur px-2 py-1 text-xs">
            <BadgeCheck className="w-3.5 h-3.5 text-(--accent)" />
            <span>Verified</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-semibold truncate">{name || "Untitled"}</h3>
          <span className="text-xs text-(--muted) shrink-0">{symbol}</span>
        </div>

        {/* Mint form */}
        <div className="mt-auto">
          <MintForm contractAddress={contract_address} name={name || ""} />
        </div>
      </div>
    </article>
  )
}
