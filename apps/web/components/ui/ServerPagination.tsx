// components/ui/ServerPagination.tsx
"use client"

import Link from "next/link"
import { ReactNode } from "react"
import { IoIosArrowBack, IoIosArrowForward } from "react-icons/io"

interface PaginationProps {
  currentPage: number
  totalPages: number
  /** Base URL used when rendering links (server-side pagination). */
  baseUrl?: string
  /** Extra query params to preserve in link mode (e.g. search). */
  query?: Record<string, string | undefined>
  /** When provided, renders buttons that call this instead of navigating. */
  onPageChange?: (page: number) => void
  disabled?: boolean
}

function pageNumbers(currentPage: number, totalPages: number) {
  return Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
    if (totalPages <= 5) return i + 1
    if (currentPage <= 3) return i + 1
    if (currentPage >= totalPages - 2) return totalPages - 4 + i
    return currentPage - 2 + i
  })
}

export function Pagination({ currentPage, totalPages, baseUrl = "", query, onPageChange, disabled = false }: PaginationProps) {
  const pages = pageNumbers(currentPage, totalPages)

  const hrefFor = (page: number) => {
    const params = new URLSearchParams()
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value) params.set(key, value)
    })
    params.set("page", String(page))
    return `${baseUrl}?${params.toString()}`
  }

  const item = (page: number, content: ReactNode, className: string) => {
    if (onPageChange) {
      return (
        <button key={page} onClick={() => onPageChange(page)} disabled={disabled} className={className}>
          {content}
        </button>
      )
    }
    return (
      <Link key={page} href={hrefFor(page)} className={className}>
        {content}
      </Link>
    )
  }

  const arrowClass = (isDisabled: boolean) => `p-2 rounded hover:bg-(--text)/10 ${isDisabled ? "pointer-events-none opacity-30" : ""}`
  const numberClass = (page: number) => `px-3 py-1 rounded ${currentPage === page ? "bg-(--accent) text-(--bg-secondary)" : "hover:bg-(--text)/10"}`

  return (
    <div className="flex justify-center items-center gap-2 py-4">
      {item(currentPage - 1, <IoIosArrowBack />, arrowClass(currentPage === 1 || disabled))}

      {pages[0] > 1 && (
        <>
          {item(1, 1, numberClass(1))}
          {pages[0] > 2 && <span className="px-2">...</span>}
        </>
      )}

      {pages.map((page) => item(page, page, numberClass(page)))}

      {pages[pages.length - 1] < totalPages && (
        <>
          {pages[pages.length - 1] < totalPages - 1 && <span className="px-2">...</span>}
          {item(totalPages, totalPages, numberClass(totalPages))}
        </>
      )}

      {item(currentPage + 1, <IoIosArrowForward />, arrowClass(currentPage === totalPages || disabled))}
    </div>
  )
}
