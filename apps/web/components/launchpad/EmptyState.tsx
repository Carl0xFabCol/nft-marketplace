import { PackageOpen } from "lucide-react"

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed border-(--accent)/30 bg-(--accent)/5">
      <PackageOpen className="w-12 h-12 text-(--accent)/60 mb-4" />
      <h3 className="text-lg font-semibold mb-1">There are no collections available</h3>
      <p className="text-sm text-(--muted) max-w-sm text-center">Be the first to register a collection and start minting.</p>
    </div>
  )
}
