// components/ui/ServerPagination.tsx
import Link from "next/link"
import { IoIosArrowBack, IoIosArrowForward } from "react-icons/io"

interface ServerPaginationProps {
  currentPage: number
  totalPages: number
  baseUrl: string
}

export function Pagination({ currentPage, totalPages, baseUrl }: ServerPaginationProps) {
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
    if (totalPages <= 5) return i + 1
    if (currentPage <= 3) return i + 1
    if (currentPage >= totalPages - 2) return totalPages - 4 + i
    return currentPage - 2 + i
  })

  return (
    <div className="flex justify-center items-center gap-2 py-4">
      <Link href={`${baseUrl}?page=${currentPage - 1}`} className={`p-2 rounded hover:bg-(--text)/10 ${currentPage === 1 ? "pointer-events-none opacity-30" : ""}`}>
        <IoIosArrowBack />
      </Link>

      {pages[0] > 1 && (
        <>
          <Link href={`${baseUrl}?page=1`} className={`px-3 py-1 rounded ${currentPage === 1 ? "bg-(--accent) text-(--bg-secondary)" : "hover:bg-(--text)/10"}`}>
            1
          </Link>
          {pages[0] > 2 && <span className="px-2">...</span>}
        </>
      )}

      {pages.map((page) => (
        <Link key={page} href={`${baseUrl}?page=${page}`} className={`px-3 py-1 rounded ${currentPage === page ? "bg-(--accent) text-(--bg-secondary)" : "hover:bg-(--text)/10"}`}>
          {page}
        </Link>
      ))}

      {pages[pages.length - 1] < totalPages && (
        <>
          {pages[pages.length - 1] < totalPages - 1 && <span className="px-2">...</span>}
          <Link href={`${baseUrl}?page=${totalPages}`} className={`px-3 py-1 rounded ${currentPage === totalPages ? "bg-(--accent) text-(--bg-secondary)" : "hover:bg-(--text)/10"}`}>
            {totalPages}
          </Link>
        </>
      )}

      <Link href={`${baseUrl}?page=${currentPage + 1}`} className={`p-2 rounded hover:bg-(--text)/10 ${currentPage === totalPages ? "pointer-events-none opacity-30" : ""}`}>
        <IoIosArrowForward />
      </Link>
    </div>
  )
}
