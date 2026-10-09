export function CollectionsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-(--accent)/20 bg-(--accent)/5 overflow-hidden animate-pulse">
          <div className="aspect-square bg-(--accent)/10" />
          <div className="p-4 flex flex-col gap-3">
            <div className="h-4 w-2/3 rounded bg-(--accent)/15" />
            <div className="h-9 w-full rounded bg-(--accent)/15" />
          </div>
        </div>
      ))}
    </div>
  )
}
