export function NFTDetailSkeleton() {
  return (
    <div className="card rounded p-2">
      <div className="flex flex-col lg:flex-row gap-4 ">
        <div className="lg:w-1/2 pr-2 aspect-square rounded-2xl">
          <div className=" bg-(--bg) animate-pulse aspect-square rounded-2xl "></div>
        </div>
        <div className="flex flex-col gap-4 grow">
          <div className="flex w-full">
            <div className="flex flex-col gap-2">
              <div className="px-26 py-6 animate-pulse bg-(--bg) rounded"></div>
              <div className="px-16 w-fit py-3 animate-pulse bg-(--bg) rounded"></div>
            </div>
          </div>
          <div className="w-full  py-16 animate-pulse bg-(--bg) rounded-xl"></div>
          <div className="flex w-full gap-2">
            <div className="px-16 py-6 animate-pulse bg-(--bg) rounded"></div>
            <div className="px-18 py-6 animate-pulse bg-(--bg) rounded"></div>
            <div className="px-16 py-6 animate-pulse bg-(--bg) rounded"></div>
          </div>
        </div>
      </div>
    </div>
  )
}
