// Guard: wei never reaches the web as a JS number. Every select on a table with
// amount columns must use explicit columns (no "*") and cast each amount column
// to text. Scans the real sources, so a new query cannot silently regress.
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { AMOUNT_COLUMNS, COLLECTION_BID_COLUMNS, COLLECTION_COLUMNS, LISTING_COLUMNS, TOKEN_BID_COLUMNS, WEI_TABLES } from "@/lib/supabase/columns"

const WEB = path.resolve(__dirname, "..")
const CONSTANTS: Record<string, string> = { LISTING_COLUMNS, TOKEN_BID_COLUMNS, COLLECTION_BID_COLUMNS, COLLECTION_COLUMNS }

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue
    const full = path.join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(full)
  }
  return out
}

/** The select argument (resolved through the column constants) of each `.from(<wei table>)…select(…)`. */
function weiTableSelects(): Array<{ where: string; table: string; columns: string }> {
  const found: Array<{ where: string; table: string; columns: string }> = []
  for (const file of walk(WEB)) {
    const src = readFileSync(file, "utf8")
    for (const m of src.matchAll(/\.from\(\s*"(\w+)"\s*\)/g)) {
      const table = m[1]
      if (!(WEI_TABLES as readonly string[]).includes(table)) continue
      const rest = src.slice(m.index! + m[0].length, m.index! + m[0].length + 400)
      const sel = /^\s*\.select\(\s*(["`])([\s\S]*?)\1/.exec(rest) ?? /^\s*\.select\(\s*([A-Z_]+)\s*[,)]/.exec(rest)
      const where = `${path.relative(WEB, file)}:${src.slice(0, m.index).split("\n").length}`
      if (!/^\s*\.select\(/.test(rest)) continue // update/insert/rpc paths, not reads
      if (!sel) {
        found.push({ where, table, columns: "<unparsed select>" })
        continue
      }
      const raw = sel.length === 3 ? sel[2] : CONSTANTS[sel[1]] ?? `<unknown ${sel[1]}>`
      const columns = raw.replace(/\$\{(\w+)\}/g, (_, k: string) => CONSTANTS[k] ?? `<unknown ${k}>`)
      found.push({ where, table, columns })
    }
  }
  return found
}

function violations(columns: string): string[] {
  const out: string[] = []
  // Top level only: strip embedded resources like nfts(count) / user_nfts:nfts!inner(...)
  const top = columns.replace(/\w+(:\w+)?(!\w+)?\([^()]*\)/g, "")
  if (/(^|,)\s*\*\s*(,|$)/.test(top)) out.push('selects "*"')
  for (const col of AMOUNT_COLUMNS) {
    for (const m of columns.matchAll(new RegExp(`\\b${col}\\b(::\\w+)?`, "g"))) {
      if (m[1] !== "::text") out.push(`${col} without ::text`)
    }
  }
  if (columns.includes("<unknown") || columns.includes("<unparsed")) out.push(columns)
  return out
}

describe("wei is read as text (no JS number)", () => {
  it("finds the market reads", () => {
    const tables = new Set(weiTableSelects().map((s) => s.table))
    for (const t of WEI_TABLES) expect(tables.has(t), t).toBe(true)
  })

  it("every select on listings/bids/collections casts amounts and avoids *", () => {
    const bad = weiTableSelects()
      .map((s) => ({ ...s, v: violations(s.columns) }))
      .filter((s) => s.v.length)
      .map((s) => `${s.where} ${s.table}: ${s.v.join("; ")}`)
    expect(bad).toEqual([])
  })

  it("the guard itself flags * and uncast amounts", () => {
    expect(violations("*")).toEqual(['selects "*"'])
    expect(violations("id, price")).toEqual(["price without ::text"])
    expect(violations("id, price::numeric")).toEqual(["price without ::text"])
    expect(violations("token_id, price::text")).toEqual([])
    expect(violations(`${COLLECTION_COLUMNS}, nfts(count)`)).toEqual([])
  })
})
