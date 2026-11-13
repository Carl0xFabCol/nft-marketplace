// ─────────────────────────────────────────────────────────────────────────────
// The rehearsal chain (31337 / "anvil") must never reach production config.
// launch.ts registers it in process memory only; this scanner proves no
// production source file mentions it. Test files and the rehearsal package
// itself are excluded. Used by __tests__/productionGuard.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

/** Production source roots, relative to the repo root. */
export const PRODUCTION_ROOTS = [
  "packages/shared/src",
  "packages/contracts/src",
  "packages/contracts/scripts",
  "packages/database/src",
  "apps/indexer/src",
  "apps/web/actions",
  "apps/web/app",
  "apps/web/components",
  "apps/web/constants",
  "apps/web/hooks",
  "apps/web/lib",
  "apps/web/services",
  "apps/web/types",
  "apps/web/next.config.ts",
  "apps/web/proxy.ts",
  "packages/contracts/foundry/foundry.toml",
  "packages/contracts/foundry/script",
] as const

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "__tests__", "__integration__", "__localdb__", "test-utils", "out", "cache", "broadcast"])
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|toml|sol)$/
const TEST_FILE = /\.(test|spec|integration\.test|localdb\.test|rehearsal\.test)\.(ts|tsx)$/

export interface GuardHit {
  file: string
  line: number
  text: string
  rule: string
}

/**
 * Rules:
 *  - "31337" anywhere in a production file;
 *  - "anvil" in a TS/JS/JSON/TOML file (chain maps, address maps, network
 *    tables). The pre-existing NETWORK=anvil branch in DeploymentConfig.sol
 *    is the Foundry test target (chainId = block.chainid, no address) and
 *    is allowed; Solidity is only checked for 31337.
 */
export function scanText(file: string, text: string): GuardHit[] {
  const hits: GuardHit[] = []
  const isSol = file.endsWith(".sol")
  text.split(/\r?\n/).forEach((line, i) => {
    if (/\b31337\b/.test(line)) hits.push({ file, line: i + 1, text: line.trim(), rule: "31337" })
    if (!isSol && /\banvil\b/i.test(line)) hits.push({ file, line: i + 1, text: line.trim(), rule: "anvil" })
  })
  return hits
}

export function productionFiles(repoRoot: string): string[] {
  const out: string[] = []
  const walk = (p: string) => {
    const st = statSync(p)
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(path.basename(p))) return
      for (const name of readdirSync(p)) walk(path.join(p, name))
    } else if (SOURCE_EXT.test(p) && !TEST_FILE.test(p)) {
      out.push(p)
    }
  }
  for (const root of PRODUCTION_ROOTS) walk(path.join(repoRoot, root))
  return out.sort()
}

export function scanProduction(repoRoot: string): GuardHit[] {
  return productionFiles(repoRoot).flatMap((f) => scanText(path.relative(repoRoot, f), readFileSync(f, "utf8")))
}
