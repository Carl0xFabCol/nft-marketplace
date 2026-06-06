"use client"

export default function UserDashboardSkeleton() {
  return (
    <div className="flex flex-col px-1 gap-2 w-full relative h-full">
      <div className="flex lg:gap-1 w-full relative grow">
        <div className="flex flex-2 h-full flex-col py-3 lg:pr-4 p-4 card rounded"></div>
      </div>
    </div>
  )
}
