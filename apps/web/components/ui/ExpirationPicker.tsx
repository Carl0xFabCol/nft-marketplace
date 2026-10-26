import { useState } from "react"

const presets = [
  { label: "1 Hour", ms: 60 * 60 * 1000 },
  { label: "1 Day", ms: 24 * 60 * 60 * 1000 },
  { label: "7 Days", ms: 7 * 24 * 60 * 60 * 1000 },
]

export default function ExpirationPicker({ onChange }: { onChange: (d: Date) => void }) {
  const [custom, setCustom] = useState("")

  function setCustomDate(v: string) {
    setCustom(v)
    onChange(new Date(v))
  }

  return (
    <div className="flex flex-col text-xs border border-(--text)/20 rounded">
      <div className="flex rounded-t-md w-full overflow-hidden">
        {presets.map((p) => (
          <button key={p.label} onClick={() => {
              const date = new Date(Date.now() + p.ms)
              onChange(date)
              setCustom(date.toISOString().slice(0, 16))
            }} className="p-1 text-xs grow bg-transparent! text-(--text)!  text-sm hover:bg-gray-100">
            {p.label}
          </button>
        ))}
      </div>

      <input type="datetime-local" value={custom} onChange={(e) => setCustomDate(e.target.value)} className=" px-3 py-2 rounded-b-md" />
    </div>
  )
}
