"use client"

import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"

export function CollectionsSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter()
  const [value, setValue] = useState(initialQuery)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = value.trim()
    router.push(query ? `/collections?q=${encodeURIComponent(query)}` : "/collections")
  }

  const clear = () => {
    setValue("")
    router.push("/collections")
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 w-full max-w-md">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Search by name, symbol or address"
          className="w-full rounded-lg border border-(--accent)/30 bg-(--accent)/5 pl-9 pr-9 py-2 text-sm focus:outline-none focus:border-(--accent)"
        />
        {value && (
          <button type="button" onClick={clear} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent! text-(--text)! opacity-50 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <button type="submit" className="rounded-lg bg-(--accent) text-black font-semibold px-4 py-2 text-sm hover:opacity-90 transition">
        Search
      </button>
    </form>
  )
}
