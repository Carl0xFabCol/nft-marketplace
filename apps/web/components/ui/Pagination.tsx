// components/ui/Pagination.tsx
import { IoIosArrowBack, IoIosArrowForward } from "react-icons/io"

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
    if (totalPages <= 5) return i + 1

    if (currentPage <= 3) return i + 1
    if (currentPage >= totalPages - 2) return totalPages - 4 + i

    return currentPage - 2 + i
  })

  return (
    <div className="flex justify-center items-center gap-2 py-4">
      <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="p-2 rounded hover:bg-(--text)/10 disabled:opacity-30 disabled:hover:bg-transparent">
        <IoIosArrowBack />
      </button>

      {pages[0] > 1 && (
        <>
          <button onClick={() => onPageChange(1)} className={`px-3 py-1 rounded ${currentPage === 1 ? "bg-(--accent) text-(--bg-secondary)" : "hover:bg-(--text)/10"}`}>
            1
          </button>
          {pages[0] > 2 && <span className="px-2">...</span>}
        </>
      )}

      {pages.map((page) => (
        <button key={page} onClick={() => onPageChange(page)} className={`px-3 py-1 rounded ${currentPage === page ? "bg-(--accent) text-(--bg-secondary)" : "hover:bg-(--text)/10"}`}>
          {page}
        </button>
      ))}

      {pages[pages.length - 1] < totalPages && (
        <>
          {pages[pages.length - 1] < totalPages - 1 && <span className="px-2">...</span>}
          <button onClick={() => onPageChange(totalPages)} className={`px-3 py-1 rounded ${currentPage === totalPages ? "bg-(--accent) text-(--bg-secondary)" : "hover:bg-(--text)/10"}`}>
            {totalPages}
          </button>
        </>
      )}

      <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="p-2 rounded hover:bg-(--text)/10 disabled:opacity-30 disabled:hover:bg-transparent">
        <IoIosArrowForward />
      </button>
    </div>
  )
}
